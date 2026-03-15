import { Transaction, Receipt } from './types';

/**
 * Extract potential amounts from a receipt filename.
 * e.g. "facture_1170.00.pdf" → [1170], "loyer-1170,00.jpg" → [1170]
 */
function extractAmountsFromFilename(filename: string): number[] {
  const amounts: number[] = [];
  // Match patterns like 1170.00, 1170,00, 1 170,00, 1170
  const patterns = [
    /(\d{1,3}(?:[\s_]\d{3})*[.,]\d{2})/g,  // with decimals
    /(\d{3,})/g,                              // whole numbers 3+ digits
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(filename)) !== null) {
      const val = parseFloat(match[1].replace(/[\s_]/g, '').replace(',', '.'));
      if (!isNaN(val) && val > 0) amounts.push(val);
    }
  }

  return [...new Set(amounts)];
}

/**
 * Normalize a label for fuzzy matching
 */
function normalizeLabel(label: string): string[] {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9àâäéèêëïîôùûüÿçœæ\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3);
}

/**
 * Check if a filename contains keywords from a transaction label
 */
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

/**
 * Try to auto-match a receipt with pending transactions.
 * Returns the best match or null.
 */
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

    // Amount match from filename
    for (const amt of fileAmounts) {
      if (Math.abs(amt - tx.amount) < 0.01) {
        score += 50;
        reasons.push(`Montant ${amt}€ trouvé dans le nom du fichier`);
      }
    }

    // Label match from filename
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
    return {
      receiptId: receipt.id,
      transactionId: null,
      confidence: 'none',
      note: 'Aucune correspondance trouvée — réconciliation manuelle requise',
    };
  }

  const best = candidates[0];

  if (best.score >= 50 && (candidates.length === 1 || best.score > candidates[1].score * 1.5)) {
    return {
      receiptId: receipt.id,
      transactionId: best.tx.id,
      confidence: 'high',
      note: `Auto-rapproché: ${best.reason}`,
    };
  }

  if (best.score >= 30) {
    return {
      receiptId: receipt.id,
      transactionId: best.tx.id,
      confidence: 'medium',
      note: `Correspondance probable: ${best.reason} — vérification manuelle recommandée`,
    };
  }

  return {
    receiptId: receipt.id,
    transactionId: null,
    confidence: 'none',
    note: 'Correspondance trop faible — réconciliation manuelle requise',
  };
}
