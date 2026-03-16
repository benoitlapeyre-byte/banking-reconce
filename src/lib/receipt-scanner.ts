import Tesseract from 'tesseract.js';
import { extractStructuredLines } from './pdf-parser';

/**
 * Extract text content from a receipt file (PDF or image) using OCR/text extraction.
 * Returns extracted text for amount parsing.
 */
export async function extractTextFromReceipt(file: File): Promise<string> {
  if (file.type === 'application/pdf') {
    const lines = await extractStructuredLines(file);
    return lines.map(l => l.text).join('\n');
  }

  // Image files: use Tesseract OCR
  if (file.type.startsWith('image/')) {
    const result = await Tesseract.recognize(file, 'fra+eng', {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          console.log(`[OCR] Progress: ${Math.round((m.progress || 0) * 100)}%`);
        }
      },
    });
    console.log('[OCR] Extracted text:', result.data.text);
    return result.data.text;
  }

  return '';
}

/**
 * Parse TTC amounts from extracted receipt text.
 * Looks for patterns like "TTC", "Total", "Montant", "Net à payer", etc.
 * and extracts the associated amounts.
 */
export function extractAmountsFromText(text: string): number[] {
  const amounts: number[] = [];
  const lines = text.split('\n');

  // Patterns that indicate a total/TTC amount (high priority)
  const ttcPatterns = [
    /(?:total\s*t\.?t\.?c\.?|montant\s*t\.?t\.?c\.?|t\.?t\.?c\.?\s*:?)\s*[:\s]*(\d[\d\s.,]*\d)/i,
    /(?:net\s*[àa]\s*payer|montant\s*d[ûu]|total\s*[àa]\s*payer)\s*[:\s]*(\d[\d\s.,]*\d)/i,
    /(?:total\s*g[ée]n[ée]ral|total\s*facture|montant\s*total)\s*[:\s]*(\d[\d\s.,]*\d)/i,
    /(?:total|somme|montant)\s*[:\s]*(\d[\d\s.,]*\d)\s*(?:€|eur)/i,
    /(\d[\d\s.,]*\d)\s*(?:€|eur)\s*(?:t\.?t\.?c\.?)/i,
  ];

  // General amount patterns (lower priority)
  const generalAmountPattern = /(\d{1,3}(?:[\s.]\d{3})*[,]\d{2})\s*(?:€|eur|euros?)?/gi;

  // First pass: look for explicit TTC/total amounts
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

  // If we found TTC amounts, return them (they're most reliable)
  if (amounts.length > 0) {
    return [...new Set(amounts)];
  }

  // Second pass: look for lines containing "total" with amounts
  for (const line of lines) {
    const trimmed = line.trim().toLowerCase();
    if (/total|montant|somme|solde|payer/i.test(trimmed)) {
      const amountMatch = trimmed.match(/(\d{1,3}(?:[\s.]\d{3})*[,]\d{2})/);
      if (amountMatch) {
        const val = parseAmount(amountMatch[1]);
        if (val > 0) {
          amounts.push(val);
          console.log(`[Receipt Scanner] Total amount found: ${val} in "${trimmed}"`);
        }
      }
      // Also try dot decimal
      const dotMatch = trimmed.match(/(\d{1,3}(?:[,]\d{3})*[.]\d{2})/);
      if (dotMatch) {
        const val = parseAmount(dotMatch[1]);
        if (val > 0) amounts.push(val);
      }
    }
  }

  if (amounts.length > 0) {
    return [...new Set(amounts)];
  }

  // Third pass: extract all amounts from text as fallback
  const allAmounts: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = generalAmountPattern.exec(text)) !== null) {
    const val = parseAmount(match[1]);
    if (val > 0 && !(val >= 1900 && val <= 2100)) {
      allAmounts.push(val);
    }
  }

  // Also try dot-decimal amounts
  const dotPattern = /(\d{1,3}(?:[,]\d{3})*\.\d{2})(?!\d)/g;
  while ((match = dotPattern.exec(text)) !== null) {
    const val = parseAmount(match[1]);
    if (val > 0 && !(val >= 1900 && val <= 2100)) {
      allAmounts.push(val);
    }
  }

  // Return the largest amount (likely the total)
  if (allAmounts.length > 0) {
    const sorted = [...new Set(allAmounts)].sort((a, b) => b - a);
    console.log(`[Receipt Scanner] Fallback amounts (largest first):`, sorted);
    return sorted.slice(0, 3);
  }

  return [];
}

/**
 * Parse a localized amount string to a number.
 */
function parseAmount(value: string): number {
  let str = value.replace(/[\s\u00a0]/g, '').replace(/[€$£¥]/g, '');
  
  const lastComma = str.lastIndexOf(',');
  const lastDot = str.lastIndexOf('.');

  if (lastComma > lastDot) {
    // European: 1.170,50
    str = str.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
    // US: 1,170.50
    str = str.replace(/,/g, '');
  }

  const parsed = parseFloat(str);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Full receipt scanning: extract text then find amounts.
 */
export async function scanReceiptForAmounts(file: File): Promise<number[]> {
  try {
    const text = await extractTextFromReceipt(file);
    if (!text.trim()) return [];
    return extractAmountsFromText(text);
  } catch (e) {
    console.error('[Receipt Scanner] Error scanning receipt:', e);
    return [];
  }
}
