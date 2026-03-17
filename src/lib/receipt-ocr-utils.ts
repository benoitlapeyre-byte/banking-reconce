type AmountCandidate = {
  amount: number;
  score: number;
};

type DateCandidate = {
  value: string;
  score: number;
};

const POSITIVE_AMOUNT_KEYWORDS = /(?:total|t\.?t\.?c\.?|net\s*[àa]\s*payer|[àa]\s*payer|payer|montant\s*total|montant|carte|cb|visa|mastercard|debit|débit)/i;
const STRONG_TOTAL_KEYWORDS = /(?:total\s*t\.?t\.?c\.?|net\s*[àa]\s*payer|montant\s*total|total\s*[àa]\s*payer|total\s*g[ée]n[ée]ral)/i;
const NEGATIVE_AMOUNT_KEYWORDS = /(?:tva|taxe|ht\b|hors\s+taxes|sous[-\s]?total|subtotal|remise|rendu|change|avoir)/i;
const DATE_KEYWORDS = /(?:date|le|du|émis|emise|édition|edition|ticket|facture|achat)/i;

const FRENCH_MONTHS: Record<string, string> = {
  janvier: '01',
  janv: '01',
  jan: '01',
  février: '02',
  fevrier: '02',
  févr: '02',
  fevr: '02',
  fev: '02',
  mars: '03',
  avril: '04',
  avr: '04',
  mai: '05',
  juin: '06',
  juillet: '07',
  juil: '07',
  août: '08',
  aout: '08',
  aoû: '08',
  septembre: '09',
  sept: '09',
  sep: '09',
  octobre: '10',
  oct: '10',
  novembre: '11',
  nov: '11',
  décembre: '12',
  decembre: '12',
  déc: '12',
  dec: '12',
};

export function normalizeReceiptText(text: string): string {
  return text
    .replace(/\r/g, '\n')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
    .replace(/[|¦]/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/[•·]/g, '.')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n');
}

export function extractAmountsFromReceiptText(text: string): number[] {
  const lines = normalizeReceiptText(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const candidates: AmountCandidate[] = [];

  for (const line of lines) {
    const hasCurrency = /[€$£¥]|\beur\b/i.test(line);
    const hasPositiveKeywords = POSITIVE_AMOUNT_KEYWORDS.test(line);
    const hasStrongKeywords = STRONG_TOTAL_KEYWORDS.test(line);
    const hasNegativeKeywords = NEGATIVE_AMOUNT_KEYWORDS.test(line);

    for (const candidate of extractKeywordAmountCandidates(line)) {
      let score = candidate.score;
      if (hasCurrency) score += 2;
      if (hasStrongKeywords) score += 4;
      else if (hasPositiveKeywords) score += 2;
      if (hasNegativeKeywords && !candidate.preserveOnNegativeLine) score -= 4;
      candidates.push({ amount: candidate.amount, score });
    }

    const tokens = extractAmountTokens(line, hasCurrency || hasPositiveKeywords || hasStrongKeywords);
    for (const token of tokens) {
      const amount = parseAmount(token);
      if (!isPlausibleAmount(amount)) continue;

      let score = 0;
      if (hasStrongKeywords) score += 8;
      else if (hasPositiveKeywords) score += 4;
      if (hasCurrency) score += 2;
      if (hasNegativeKeywords) score -= 6;
      if (/([€$£¥]?\s*\d[\d\s.,]*\d|[€$£¥]?\s*\d+)\s*(?:€|eur)?\s*$/i.test(line)) score += 1;
      if (amount >= 1 && amount <= 5000) score += 1;
      if (amount < 2) score -= 2;
      if (amount <= 0.2) score -= 4;
      candidates.push({ amount, score });
    }
  }

  if (candidates.length === 0) return [];

  const bestByAmount = new Map<string, AmountCandidate>();
  for (const candidate of candidates) {
    const key = candidate.amount.toFixed(2);
    const existing = bestByAmount.get(key);
    if (!existing || candidate.score > existing.score) {
      bestByAmount.set(key, candidate);
    }
  }

  return [...bestByAmount.values()]
    .filter((candidate) => candidate.score > -2)
    .sort((a, b) => b.score - a.score || b.amount - a.amount)
    .map((candidate) => candidate.amount)
    .slice(0, 5);
}

export function extractDateFromReceiptText(text: string): string | null {
  const lines = normalizeReceiptText(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const candidates: DateCandidate[] = [];
  const writtenPattern = new RegExp(`(?:^|\\D)(\\d{1,2})(?:er)?\\s+(${Object.keys(FRENCH_MONTHS).join('|')})\\s+(\\d{2,4})(?!\\d)`, 'ig');

  for (const [index, rawLine] of lines.entries()) {
    const line = normalizeDateLine(rawLine);
    let baseScore = (DATE_KEYWORDS.test(line) ? 6 : 0) + (index < 8 ? 3 : 0);

    if (/date\s*(?:de|du)?\s*(?:facture|ticket|achat|commande)?/i.test(line)) baseScore += 6;
    if (/facture|ticket/i.test(line)) baseScore += 2;

    const euMatches = [...line.matchAll(/(?:^|\D)(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{2,4})(?!\d)/g)];
    for (const match of euMatches) {
      const iso = toIsoDate(match[1], match[2], match[3]);
      if (iso) candidates.push({ value: iso, score: baseScore + 5 });
    }

    const isoMatches = [...line.matchAll(/(?:^|\D)(\d{4})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{1,2})(?!\d)/g)];
    for (const match of isoMatches) {
      const iso = toIsoDate(match[3], match[2], match[1]);
      if (iso) candidates.push({ value: iso, score: baseScore + 4 });
    }

    if (DATE_KEYWORDS.test(line)) {
      const spacedMatches = [...line.matchAll(/(?:^|\D)(\d{1,2})\s+(\d{1,2})\s+(\d{2,4})(?!\d)/g)];
      for (const match of spacedMatches) {
        const iso = toIsoDate(match[1], match[2], match[3]);
        if (iso) candidates.push({ value: iso, score: baseScore + 2 });
      }
    }

    for (const match of line.matchAll(writtenPattern)) {
      const month = FRENCH_MONTHS[match[2].toLowerCase()];
      const iso = month ? toIsoDate(match[1], month, match[3]) : null;
      if (iso) candidates.push({ value: iso, score: baseScore + 5 });
    }
  }

  if (candidates.length === 0) return null;

  const bestByDate = new Map<string, DateCandidate>();
  for (const candidate of candidates) {
    const existing = bestByDate.get(candidate.value);
    if (!existing || candidate.score > existing.score) {
      bestByDate.set(candidate.value, candidate);
    }
  }

  return [...bestByDate.values()]
    .sort((a, b) => b.score - a.score || b.value.localeCompare(a.value))[0]?.value ?? null;
}

function extractAmountTokens(line: string, allowIntegerFallback: boolean): string[] {
  const results = new Set<string>();
  const decimalPattern = /(?:€\s*)?\d{1,3}(?:[\s.,]\d{3})*(?:[.,]\d{2})(?:\s*€)?|(?:€\s*)?\d+(?:[.,]\d{2})(?:\s*€)?/g;
  for (const match of line.match(decimalPattern) ?? []) {
    results.add(match.trim());
  }

  if (allowIntegerFallback && results.size === 0) {
    const integerPattern = /(?:€\s*)?\d{1,5}(?:\s*€)?/g;
    for (const match of line.match(integerPattern) ?? []) {
      const cleaned = match.trim();
      if (/^\d{4}$/.test(cleaned.replace(/\D/g, '')) && /^20\d{2}$/.test(cleaned.replace(/\D/g, ''))) continue;
      results.add(cleaned);
    }
  }

  return [...results];
}

function extractKeywordAmountCandidates(line: string): Array<{ amount: number; score: number; preserveOnNegativeLine?: boolean }> {
  const contexts = [
    { pattern: STRONG_TOTAL_KEYWORDS, score: 14, preserveOnNegativeLine: true },
    { pattern: /montant\s*t\.?t\.?c\.?|\bt\.?t\.?c\.?\b/i, score: 12, preserveOnNegativeLine: true },
    { pattern: /mode\s+de\s+r[èe]glement|r[èe]glement|\bcb\b|carte|visa|mastercard|debit|débit/i, score: 11, preserveOnNegativeLine: true },
    { pattern: /\btotal\b|net\s*[àa]\s*payer|[àa]\s*payer|montant\s+total/i, score: 9, preserveOnNegativeLine: false },
  ];

  const candidates: Array<{ amount: number; score: number; preserveOnNegativeLine?: boolean }> = [];

  for (const context of contexts) {
    const match = line.match(context.pattern);
    if (!match || match.index === undefined) continue;

    const tail = line.slice(match.index);
    const amounts = extractAmountTokens(tail, true)
      .map((token) => parseAmount(token))
      .filter((amount) => isPlausibleAmount(amount));

    if (amounts.length === 0) continue;

    const preferred = choosePreferredKeywordAmount(line, amounts);
    candidates.push({ amount: preferred, score: context.score, preserveOnNegativeLine: context.preserveOnNegativeLine });
  }

  return candidates;
}

function choosePreferredKeywordAmount(line: string, amounts: number[]): number {
  if (/mode\s+de\s+r[èe]glement|r[èe]glement|\bcb\b|carte|visa|mastercard|debit|débit/i.test(line)) {
    return amounts[amounts.length - 1];
  }

  return Math.max(...amounts);
}

function normalizeDateLine(line: string): string {
  return line
    .replace(/[Oo](?=\d)/g, '0')
    .replace(/(?<=\d)[Oo]/g, '0')
    .replace(/[Il|](?=\d)/g, '1')
    .replace(/(?<=\d)[Il|]/g, '1');
}

function parseAmount(value: string): number {
  let str = value
    .replace(/[Oo](?=\d)/g, '0')
    .replace(/(?<=\d)[Oo]/g, '0')
    .replace(/[Il|](?=\d)/g, '1')
    .replace(/(?<=\d)[Il|]/g, '1')
    .replace(/[€$£¥]/g, '')
    .replace(/\s+/g, '')
    .replace(/[^\d,.-]/g, '');

  if (!str) return 0;

  const lastComma = str.lastIndexOf(',');
  const lastDot = str.lastIndexOf('.');

  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      str = str.replace(/,/g, '');
    }
  } else if (lastComma !== -1) {
    const decimals = str.length - lastComma - 1;
    str = decimals === 2 ? str.replace(',', '.') : str.replace(/,/g, '');
  } else if (lastDot !== -1) {
    const decimals = str.length - lastDot - 1;
    str = decimals === 2 ? str : str.replace(/\./g, '');
  }

  const parsed = Number.parseFloat(str);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isPlausibleAmount(amount: number): boolean {
  return amount > 0 && amount < 100000 && !(amount >= 1900 && amount <= 2100);
}

function toIsoDate(dayValue: string, monthValue: string, yearValue: string): string | null {
  const day = Number.parseInt(dayValue, 10);
  const month = Number.parseInt(monthValue, 10);
  let year = Number.parseInt(yearValue, 10);

  if (yearValue.length === 2) {
    year += 2000;
  }

  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null;
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2000 || year > 2099) return null;

  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isPlausibleReceiptDate(iso) ? iso : null;
}

function isPlausibleReceiptDate(iso: string): boolean {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return false;

  const minDate = new Date('2000-01-01T00:00:00');
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + 31);

  return date >= minDate && date <= maxDate;
}
