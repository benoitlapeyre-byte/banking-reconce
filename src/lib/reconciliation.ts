import { Transaction, Receipt, PersonalExpense } from './types';

/**
 * Parse a localized number string (handles European comma decimal and space/dot thousands).
 * e.g. "1 170,50" → 1170.5, "1.170,50" → 1170.5, "1170.50" → 1170.5
 */
function parseLocalizedNumber(value: string): number {
  if (!value || value === '') return 0;
  let str = String(value).trim();
  // Remove currency symbols and whitespace
  str = str.replace(/[¤$€£¥\s]/g, '');
  
  const lastComma = str.lastIndexOf(',');
  const lastDot = str.lastIndexOf('.');
  // Auto-detect: if comma comes after dot, comma is decimal (European)
  const isCommaDecimal = lastComma > lastDot;

  if (isCommaDecimal) {
    str = str.replace(/\./g, ''); // remove thousand separators
    str = str.replace(',', '.'); // convert decimal
  } else {
    str = str.replace(/,/g, ''); // remove thousand separators
  }

  const parsed = parseFloat(str);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Extract potential amounts from a receipt filename.
 * Handles: "facture_1170,50.pdf", "loyer-1 170.00.pdf", "note_42.50€.pdf"
 */
function extractAmountsFromFilename(filename: string): number[] {
  const nameWithoutExt = filename.replace(/\.[^.]+$/, '');
  const amounts: number[] = [];
  
  // Pattern 1: amounts with decimal (comma or dot) — e.g. 1170,50 or 1170.50 or 1 170,50
  const decimalPattern = /(\d{1,3}(?:[\s_.]\d{3})*[,]\d{2})|(\d{1,3}(?:[\s_,]\d{3})*[.]\d{2})/g;
  let match: RegExpExecArray | null;
  while ((match = decimalPattern.exec(nameWithoutExt)) !== null) {
    const val = parseLocalizedNumber(match[0]);
    if (val > 0) amounts.push(val);
  }

  // Pattern 2: integers that look like amounts (3+ digits, no decimal)
  if (amounts.length === 0) {
    const intPattern = /(\d{2,})/g;
    while ((match = intPattern.exec(nameWithoutExt)) !== null) {
      const val = parseFloat(match[1]);
      // Skip things that look like dates (2024, 2025, 2026, etc.)
      if (!isNaN(val) && val > 0 && !(val >= 1900 && val <= 2100)) {
        amounts.push(val);
      }
    }
  }

  return [...new Set(amounts)];
}

function normalizeLabel(label: string): string[] {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9àâäéèêëïîôùûüÿçœæ\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3);
}

function filenameMatchesLabel(filename: string, label: string): number {
  const fnWords = normalizeLabel(filename);
  const labelWords = normalizeLabel(label);
  if (labelWords.length === 0) return 0;

  let matches = 0;
  for (const lw of labelWords) {
    if (fnWords.some(fw => fw.includes(lw) || lw.includes(fw))) {
      matches++;
    }
  }
  return matches / labelWords.length;
}

export interface ReconciliationResult {
  receiptId: string;
  transactionId: string | null;
  confidence: 'high' | 'medium' | 'none';
  note: string;
}

export function autoReconcile(
  receipt: Receipt,
  transactions: Transaction[]
): ReconciliationResult {
  const pendingTxs = transactions.filter(t => t.status === 'pending');
  if (pendingTxs.length === 0) {
    return { receiptId: receipt.id, transactionId: null, confidence: 'none', note: 'Aucune transaction en attente' };
  }

  const fileAmounts = extractAmountsFromFilename(receipt.name);

  type Candidate = { tx: Transaction; score: number; reason: string };
  const candidates: Candidate[] = [];

  for (const tx of pendingTxs) {
    let score = 0;
    const reasons: string[] = [];

    for (const amt of fileAmounts) {
      if (Math.abs(amt - tx.amount) < 0.01) {
        score += 50;
        reasons.push(`Montant ${amt}€ trouvé dans le nom du fichier`);
      }
    }

    const labelScore = filenameMatchesLabel(receipt.name, tx.label);
    if (labelScore > 0.3) {
      score += labelScore * 30;
      reasons.push(`Correspondance libellé (${Math.round(labelScore * 100)}%)`);
    }

    if (score > 0) {
      candidates.push({ tx, score, reason: reasons.join(' + ') });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    return { receiptId: receipt.id, transactionId: null, confidence: 'none', note: 'Aucune correspondance trouvée — réconciliation manuelle requise' };
  }

  const best = candidates[0];

  if (best.score >= 50 && (candidates.length === 1 || best.score > candidates[1].score * 1.5)) {
    return { receiptId: receipt.id, transactionId: best.tx.id, confidence: 'high', note: `Auto-rapproché: ${best.reason}` };
  }

  if (best.score >= 30) {
    return { receiptId: receipt.id, transactionId: best.tx.id, confidence: 'medium', note: `Correspondance probable: ${best.reason} — vérification manuelle recommandée` };
  }

  return { receiptId: receipt.id, transactionId: null, confidence: 'none', note: 'Correspondance trop faible — réconciliation manuelle requise' };
}

/**
 * Extract personal expense info from a receipt filename.
 * e.g. "restaurant_comptoir_42.50_2026-01-15.pdf" → { merchant, amount, date }
 */
export function extractPersonalExpenseFromFilename(filename: string): Partial<Omit<PersonalExpense, 'id' | 'createdAt'>> | null {
  const nameWithoutExt = filename.replace(/\.[^.]+$/, '');
  
  const amounts = extractAmountsFromFilename(nameWithoutExt);
  if (amounts.length === 0) return null;

  // Extract date
  const datePatterns = [
    /(\d{4}[-_]\d{2}[-_]\d{2})/,
    /(\d{2}[-_]\d{2}[-_]\d{4})/,
    /(\d{2}[-_]\d{2}[-_]\d{2})(?!\d)/,
  ];
  
  let extractedDate: string | undefined;
  for (const dp of datePatterns) {
    const m = dp.exec(nameWithoutExt);
    if (m) {
      const raw = m[1].replace(/_/g, '-');
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        extractedDate = raw;
      } else if (/^\d{2}-\d{2}-\d{4}$/.test(raw)) {
        const [d, mo, y] = raw.split('-');
        extractedDate = `${y}-${mo}-${d}`;
      } else if (/^\d{2}-\d{2}-\d{2}$/.test(raw)) {
        const [d, mo, y] = raw.split('-');
        extractedDate = `20${y}-${mo}-${d}`;
      }
      break;
    }
  }

  // Extract merchant name
  let merchantPart = nameWithoutExt
    .replace(/\d{4}[-_]\d{2}[-_]\d{2}/g, '')
    .replace(/\d{2}[-_]\d{2}[-_]\d{4}/g, '')
    .replace(/\d{2}[-_]\d{2}[-_]\d{2}/g, '')
    .replace(/\d{1,3}(?:[\s_]\d{3})*[.,]\d{2}/g, '')
    .replace(/\d{3,}/g, '')
    .replace(/^(facture|recu|ticket|note|justificatif|receipt|invoice)[-_\s]*/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();

  if (merchantPart.length < 2) {
    merchantPart = nameWithoutExt.replace(/[-_]+/g, ' ').replace(/\.\w+$/, '').trim();
  }

  merchantPart = merchantPart.charAt(0).toUpperCase() + merchantPart.slice(1);

  return {
    merchant: merchantPart || 'Dépense personnelle',
    amount: amounts[0],
    date: extractedDate || new Date().toISOString().slice(0, 10),
  };
}
