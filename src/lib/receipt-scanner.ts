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
    return extractTextFromReceiptImage(file, onProgress);
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

async function extractTextFromReceiptImage(
  file: File,
  onProgress?: (p: ScanProgress) => void
): Promise<string> {
  const originalText = await recognizeReceiptImage(file, file.name, onProgress, 5, 70);

  if (hasReliableReceiptData(originalText)) {
    return originalText;
  }

  onProgress?.({ status: 'extracting', progress: 72, fileName: file.name });
  const optimizedImage = await preprocessReceiptImage(file);
  if (!optimizedImage) {
    return originalText;
  }

  const optimizedText = await recognizeReceiptImage(optimizedImage, file.name, onProgress, 74, 97);
  return scoreReceiptText(optimizedText) >= scoreReceiptText(originalText) ? optimizedText : originalText;
}

async function recognizeReceiptImage(
  source: Blob | File,
  fileName: string,
  onProgress: ((p: ScanProgress) => void) | undefined,
  startProgress: number,
  endProgress: number
): Promise<string> {
  onProgress?.({ status: 'recognizing', progress: startProgress, fileName });

  const result = await Tesseract.recognize(source, 'fra+eng', {
    logger: (message) => {
      if (message.status === 'recognizing text') {
        const pct = Math.round((message.progress || 0) * 100);
        const mappedProgress = startProgress + Math.round((pct / 100) * (endProgress - startProgress));
        onProgress?.({ status: 'recognizing', progress: Math.min(mappedProgress, endProgress), fileName });
      }
    },
  });

  const text = normalizeReceiptText(result.data.text);
  console.log('[OCR] Extracted text:', text);
  return text;
}

async function preprocessReceiptImage(file: File): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const longestSide = Math.max(bitmap.width, bitmap.height);
    const scale = longestSide < 1600 ? 1600 / longestSide : longestSide > 2400 ? 2400 / longestSide : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      bitmap.close();
      return null;
    }

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const imageData = context.getImageData(0, 0, width, height);
    const { data } = imageData;

    for (let index = 0; index < data.length; index += 4) {
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
      const contrasted = clamp((luminance - 128) * 1.45 + 128, 0, 255);
      const normalized = contrasted > 176 ? 255 : contrasted < 74 ? 0 : contrasted;
      data[index] = normalized;
      data[index + 1] = normalized;
      data[index + 2] = normalized;
      data[index + 3] = 255;
    }

    context.putImageData(imageData, 0, 0);

    return await new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/png', 1);
    });
  } catch (error) {
    console.warn('[OCR] Image preprocessing failed:', error);
    return null;
  }
}

function scoreReceiptText(text: string): number {
  const normalized = normalizeReceiptText(text);
  if (!normalized.trim()) return 0;

  const amounts = extractAmountsFromReceiptText(normalized);
  const date = extractDateFromReceiptText(normalized);
  const merchant = extractMerchantFromText(normalized);
  const lineCount = normalized.split('\n').filter(Boolean).length;

  let score = Math.min(normalized.length, 400) / 20;
  if (amounts.length > 0) score += 20;
  if (amounts[0] && amounts[0] >= 1) score += 8;
  if (date) score += 18;
  if (merchant) score += 10;
  if (lineCount >= 4) score += 6;
  if (/(?:€|eur|total|ttc|montant|payer|facture|ticket|cb|visa|mastercard)/i.test(normalized)) score += 8;

  return score;
}

function hasReliableReceiptData(text: string): boolean {
  const amounts = extractAmountsFromReceiptText(text);
  const date = extractDateFromReceiptText(text);
  return amounts.length > 0 && Boolean(date);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export async function scanReceiptForAmounts(
  file: File,
  onProgress?: (p: ScanProgress) => void
): Promise<number[]> {
  const result = await scanReceipt(file, onProgress);
  return result.amounts;
}
