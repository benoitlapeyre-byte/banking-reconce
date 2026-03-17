import Tesseract from 'tesseract.js';
import { extractStructuredLines } from './pdf-parser';
import { extractAmountsFromReceiptText, extractDateFromReceiptText, normalizeReceiptText } from './receipt-ocr-utils';

export type ScanProgress = {
  status: 'extracting' | 'recognizing' | 'parsing' | 'done';
  progress: number;
  fileName: string;
};

export interface ScanResult {
  amounts: number[];
  date: string | null;
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
    return normalizeReceiptText(lines.map((line) => line.text).join('\n'));
  }

  if (file.type.startsWith('image/')) {
    onProgress?.({ status: 'recognizing', progress: 5, fileName: file.name });
    const result = await Tesseract.recognize(file, 'fra+eng', {
      logger: (message) => {
        if (message.status === 'recognizing text') {
          const pct = Math.round((message.progress || 0) * 100);
          onProgress?.({ status: 'recognizing', progress: Math.min(pct, 95), fileName: file.name });
        }
      },
    });
    const text = normalizeReceiptText(result.data.text);
    console.log('[OCR] Extracted text:', text);
    return text;
  }

  return '';
}

export function extractDateFromText(text: string): string | null {
  return extractDateFromReceiptText(text);
}

export function extractAmountsFromText(text: string): number[] {
  return extractAmountsFromReceiptText(text);
}

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
    const merchant = extractMerchantFromText(text);

    onProgress?.({ status: 'done', progress: 100, fileName: file.name });
    console.log('[Receipt Scanner] Result:', { amounts, date, merchant });
    return { amounts, date, merchant, rawText: text };
  } catch (error) {
    console.error('[Receipt Scanner] Error:', error);
    onProgress?.({ status: 'done', progress: 100, fileName: file.name });
    return { amounts: [], date: null, merchant: null, rawText: '' };
  }
}

function extractMerchantFromText(text: string): string | null {
  const lines = normalizeReceiptText(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const candidates = lines
    .slice(0, 10)
    .map((line, index) => {
      if (line.length < 3 || line.length > 60) return null;
      if (/https?:|www\.|@|\b(?:siret|tva|ticket|facture|total|ttc|montant|date|heure|caisse|client|paiement)\b/i.test(line)) return null;
      if (/^\d/.test(line) || /^\d{1,2}[\/\-.]\d{1,2}/.test(line)) return null;
      if ((line.match(/\d/g) || []).length > 3) return null;

      let score = 0;
      if (!/\d/.test(line)) score += 3;
      if (index < 3) score += 3;
      if (line === line.toUpperCase()) score += 2;
      if (/^[A-Za-zÀ-ÿ&' .-]+$/.test(line)) score += 2;
      if (line.length <= 30) score += 1;

      return { line: cleanMerchantLine(line), score };
    })
    .filter((candidate): candidate is { line: string; score: number } => Boolean(candidate && candidate.line));

  return candidates.sort((a, b) => b.score - a.score)[0]?.line ?? null;
}

function cleanMerchantLine(line: string): string {
  return line
    .replace(/^[^A-Za-zÀ-ÿ]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export async function scanReceiptForAmounts(
  file: File,
  onProgress?: (p: ScanProgress) => void
): Promise<number[]> {
  const result = await scanReceipt(file, onProgress);
  return result.amounts;
}
