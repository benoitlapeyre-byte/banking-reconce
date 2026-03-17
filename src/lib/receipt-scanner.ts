import Tesseract from 'tesseract.js';
import { extractStructuredLines } from './pdf-parser';

export type ScanProgress = {
  status: 'extracting' | 'recognizing' | 'parsing' | 'done';
  progress: number;
  fileName: string;
};

export interface ScanResult {
  amounts: number[];
  date: string | null;       // YYYY-MM-DD
  merchant: string | null;
  rawText: string;
}

export async function extractTextFromReceipt(
  file: File,
  onProgress?: (p: ScanProgress) => void
): Promise<string> {
  if (file.type === 'application/pdf') {
    onProgress?.({ status: 'extracting', progress: 20, fileName: file.name });
    const lines = await extractStructuredLines(file);
    onProgress?.({ status: 'parsing', progress: 80, fileName: file.name });
    return lines.map(l => l.text).join('\n');
  }

  if (file.type.startsWith('image/')) {
    onProgress?.({ status: 'recognizing', progress: 5, fileName: file.name });
    const result = await Tesseract.recognize(file, 'fra+eng', {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          const pct = Math.round((m.progress || 0) * 100);
          onProgress?.({ status: 'recognizing', progress: Math.min(pct, 95), fileName: file.name });
        }
      },
    });
    console.log('[OCR] Extracted text:', result.data.text);
    return result.data.text;
  }

  return '';
}

/**
 * Extract date from OCR text. Tries multiple formats.
 */
export function extractDateFromText(text: string): string | null {
  const lines = text.split('\n');

  // Date patterns with keywords
  const dateKeywords = /(?:date|le|du|émis|facture|ticket)\s*[:\s]*/i;

  for (const line of lines) {
    const trimmed = line.trim();
    if (dateKeywords.test(trimmed)) {
      const d = parseDateFromString(trimmed);
      if (d) return d;
    }
  }

  // Fallback: find any date-like pattern in entire text
  for (const line of lines) {
    const d = parseDateFromString(line.trim());
    if (d) return d;
  }

  return null;
}

function parseDateFromString(str: string): string | null {
  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const euMatch = str.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (euMatch) {
    const [, d, m, y] = euMatch;
    const day = parseInt(d, 10);
    const month = parseInt(m, 10);
    const year = parseInt(y, 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 2000 && year <= 2099) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    // Maybe MM/DD/YYYY
    if (day >= 1 && day <= 12 && month >= 1 && month <= 31 && year >= 2000 && year <= 2099) {
      return `${year}-${String(day).padStart(2, '0')}-${String(month).padStart(2, '0')}`;
    }
  }

  // DD/MM/YY
  const shortMatch = str.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2})(?!\d)/);
  if (shortMatch) {
    const [, d, m, yy] = shortMatch;
    const day = parseInt(d, 10);
    const month = parseInt(m, 10);
    const year = 2000 + parseInt(yy, 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 2000 && year <= 2099) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // YYYY-MM-DD (ISO)
  const isoMatch = str.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    const year = parseInt(y, 10);
    const month = parseInt(m, 10);
    const day = parseInt(d, 10);
    if (year >= 2000 && year <= 2099 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${y}-${m}-${d}`;
    }
  }

  // French written dates: "12 janvier 2024"
  const frMonths: Record<string, string> = {
    'janvier': '01', 'février': '02', 'fevrier': '02', 'mars': '03', 'avril': '04',
    'mai': '05', 'juin': '06', 'juillet': '07', 'août': '08', 'aout': '08',
    'septembre': '09', 'octobre': '10', 'novembre': '11', 'décembre': '12', 'decembre': '12',
    'jan': '01', 'fev': '02', 'fév': '02', 'mar': '03', 'avr': '04',
    'jui': '06', 'jul': '07', 'aoû': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'déc': '12', 'dec': '12',
  };
  const frPattern = new RegExp(
    `(\\d{1,2})\\s+(${Object.keys(frMonths).join('|')})\\s+(\\d{4})`, 'i'
  );
  const frMatch = str.match(frPattern);
  if (frMatch) {
    const day = parseInt(frMatch[1], 10);
    const month = frMonths[frMatch[2].toLowerCase()];
    const year = frMatch[3];
    if (month && day >= 1 && day <= 31) {
      return `${year}-${month}-${String(day).padStart(2, '0')}`;
    }
  }

  return null;
}

/**
 * Parse TTC amounts from extracted receipt text.
 */
export function extractAmountsFromText(text: string): number[] {
  const amounts: number[] = [];
  const lines = text.split('\n');

  // High priority: explicit TTC/total patterns
  const ttcPatterns = [
    /(?:total\s*t\.?t\.?c\.?|montant\s*t\.?t\.?c\.?|t\.?t\.?c\.?\s*:?)\s*[:\s]*(\d[\d\s.,]*\d|\d)/i,
    /(?:net\s*[àa]\s*payer|montant\s*d[ûu]|total\s*[àa]\s*payer)\s*[:\s]*(\d[\d\s.,]*\d|\d)/i,
    /(?:total\s*g[ée]n[ée]ral|total\s*facture|montant\s*total)\s*[:\s]*(\d[\d\s.,]*\d|\d)/i,
    /(?:total|somme|montant)\s*[:\s]*(\d[\d\s.,]*\d|\d)\s*(?:€|eur)/i,
    /(\d[\d\s.,]*\d|\d)\s*(?:€|eur)\s*(?:t\.?t\.?c\.?)/i,
  ];

  for (const line of lines) {
    const trimmed = line.trim();
    for (const pattern of ttcPatterns) {
      const match = trimmed.match(pattern);
      if (match) {
        const val = parseAmount(match[1]);
        if (val > 0) {
          amounts.push(val);
          console.log(`[Receipt Scanner] TTC amount found: ${val} in "${trimmed}"`);
        }
      }
    }
  }

  if (amounts.length > 0) return [...new Set(amounts)];

  // Second pass: lines with total/montant keywords
  for (const line of lines) {
    const trimmed = line.trim();
    if (/total|montant|somme|solde|payer|ttc|dû|du|net/i.test(trimmed)) {
      const vals = extractAllAmountsFromLine(trimmed);
      for (const v of vals) {
        if (v > 0) amounts.push(v);
      }
    }
  }

  if (amounts.length > 0) return [...new Set(amounts)];

  // Third pass: any amount with € symbol
  for (const line of lines) {
    const euroMatch = line.match(/(\d[\d\s.,]*\d?)\s*€/g);
    if (euroMatch) {
      for (const m of euroMatch) {
        const numPart = m.replace('€', '').trim();
        const val = parseAmount(numPart);
        if (val > 0 && !(val >= 1900 && val <= 2100)) amounts.push(val);
      }
    }
    const euroBefore = line.match(/€\s*(\d[\d\s.,]*\d?)/g);
    if (euroBefore) {
      for (const m of euroBefore) {
        const numPart = m.replace('€', '').trim();
        const val = parseAmount(numPart);
        if (val > 0 && !(val >= 1900 && val <= 2100)) amounts.push(val);
      }
    }
  }

  if (amounts.length > 0) {
    const sorted = [...new Set(amounts)].sort((a, b) => b - a);
    return sorted.slice(0, 3);
  }

  // Final fallback: all number-like patterns
  const allAmounts: number[] = [];
  const patterns = [
    /(\d{1,3}(?:[\s.]\d{3})*[,]\d{2})/g,
    /(\d{1,3}(?:[,]\d{3})*\.\d{2})(?!\d)/g,
    /(\d+[,.]\d{2})(?!\d)/g,
  ];

  for (const pat of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pat.exec(text)) !== null) {
      const val = parseAmount(match[1]);
      if (val > 0 && val < 100000 && !(val >= 1900 && val <= 2100)) {
        allAmounts.push(val);
      }
    }
  }

  if (allAmounts.length > 0) {
    const sorted = [...new Set(allAmounts)].sort((a, b) => b - a);
    console.log(`[Receipt Scanner] Fallback amounts (largest first):`, sorted);
    return sorted.slice(0, 3);
  }

  return [];
}

function extractAllAmountsFromLine(line: string): number[] {
  const results: number[] = [];
  const patterns = [
    /(\d{1,3}(?:[\s.]\d{3})*[,]\d{2})/g,
    /(\d{1,3}(?:[,]\d{3})*\.\d{2})/g,
    /(\d+[,.]\d{2})/g,
  ];
  for (const pat of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pat.exec(line)) !== null) {
      const val = parseAmount(m[1]);
      if (val > 0 && !(val >= 1900 && val <= 2100)) results.push(val);
    }
  }
  return results;
}

/**
 * Parse a localized amount string to a number.
 */
function parseAmount(value: string): number {
  let str = value.replace(/[\s\u00a0]/g, '').replace(/[€$£¥]/g, '');

  const lastComma = str.lastIndexOf(',');
  const lastDot = str.lastIndexOf('.');

  if (lastComma > lastDot) {
    str = str.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
    str = str.replace(/,/g, '');
  }

  const parsed = parseFloat(str);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Full receipt scanning: extract text, find amounts AND date.
 */
export async function scanReceipt(
  file: File,
  onProgress?: (p: ScanProgress) => void
): Promise<ScanResult> {
  try {
    const text = await extractTextFromReceipt(file, onProgress);
    onProgress?.({ status: 'parsing', progress: 90, fileName: file.name });

    if (!text.trim()) {
      onProgress?.({ status: 'done', progress: 100, fileName: file.name });
      return { amounts: [], date: null, merchant: null, rawText: '' };
    }

    const amounts = extractAmountsFromText(text);
    const date = extractDateFromText(text);

    // Try to extract merchant from first non-empty, non-date, non-number lines
    let merchant: string | null = null;
    const textLines = text.split('\n').map(l => l.trim()).filter(l => l.length > 2);
    for (const line of textLines.slice(0, 5)) {
      // Skip lines that are mostly numbers/dates
      if (/^\d/.test(line) || /^\d{1,2}[\/\-]/.test(line)) continue;
      if (/total|montant|ttc|tva|somme|payer|facture|reçu|ticket/i.test(line)) continue;
      if (line.length > 3 && line.length < 60) {
        merchant = line;
        break;
      }
    }

    onProgress?.({ status: 'done', progress: 100, fileName: file.name });
    console.log('[Receipt Scanner] Result:', { amounts, date, merchant });
    return { amounts, date, merchant, rawText: text };
  } catch (e) {
    console.error('[Receipt Scanner] Error:', e);
    onProgress?.({ status: 'done', progress: 100, fileName: file.name });
    return { amounts: [], date: null, merchant: null, rawText: '' };
  }
}

/** Legacy wrapper */
export async function scanReceiptForAmounts(
  file: File,
  onProgress?: (p: ScanProgress) => void
): Promise<number[]> {
  const result = await scanReceipt(file, onProgress);
  return result.amounts;
}
