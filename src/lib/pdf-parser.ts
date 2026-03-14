// @ts-ignore - pdfjs-dist types have internal TS issues
import * as pdfjsLib from 'pdfjs-dist';

// Use CDN worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs`;

export async function extractTextFromPDF(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();

    // Group text items by Y coordinate to reconstruct lines
    const itemsByY: Map<number, Array<{ x: number; str: string }>> = new Map();
    const Y_TOLERANCE = 3; // items within 3 units are on the same line

    for (const item of content.items) {
      if (!('str' in item) || !(item as any).transform) continue;
      const textItem = item as { str: string; transform: number[] };
      if (!textItem.str.trim() && !textItem.str.includes(' ')) continue;

      const x = textItem.transform[4];
      const y = Math.round(textItem.transform[5]);

      // Find existing Y bucket within tolerance
      let foundY: number | null = null;
      for (const existingY of itemsByY.keys()) {
        if (Math.abs(existingY - y) <= Y_TOLERANCE) {
          foundY = existingY;
          break;
        }
      }

      const bucketY = foundY ?? y;
      if (!itemsByY.has(bucketY)) itemsByY.set(bucketY, []);
      itemsByY.get(bucketY)!.push({ x, str: textItem.str });
    }

    // Sort by Y descending (PDF coordinates: top = higher Y)
    const sortedYs = [...itemsByY.keys()].sort((a, b) => b - a);

    for (const y of sortedYs) {
      const items = itemsByY.get(y)!;
      // Sort by X ascending (left to right)
      items.sort((a, b) => a.x - b.x);

      // Join with appropriate spacing
      let line = '';
      for (let j = 0; j < items.length; j++) {
        if (j > 0) {
          const gap = items[j].x - (items[j - 1].x + items[j - 1].str.length * 4);
          line += gap > 20 ? '  ' : ' ';
        }
        line += items[j].str;
      }

      const trimmed = line.trim();
      if (trimmed.length > 0) {
        fullText += trimmed + '\n';
      }
    }
  }

  console.log('[PDF Parser] Extracted text:\n', fullText);
  return fullText;
}

// Heuristic parser for French bank statements (Crédit Agricole, etc.)
// Supports: DD/MM/YYYY, DD.MM.YYYY, DD.MM, DD/MM formats
export function parseTransactions(text: string): Array<{
  date: string;
  label: string;
  amount: number;
  raw: string;
}> {
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  const transactions: Array<{ date: string; label: string; amount: number; raw: string }> = [];

  // Date patterns: DD/MM/YYYY, DD.MM.YYYY, DD/MM, DD.MM
  const datePattern = /^(\d{2}[\/\.]\d{2}(?:[\/\.]\d{2,4})?)/;

  // Amount pattern: structured French format like "1 170,00" or "847,12"
  // \d{1,3} followed by optional groups of space+3digits, then comma/dot + 2 decimals
  const amountPattern = /(\d{1,3}(?:\s\d{3})*[.,]\d{2})/g;

  // Skip lines that look like headers, totals, or balance lines
  const skipPatterns = [
    /total\s+des\s+op/i,
    /nouveau\s+solde/i,
    /ancien\s+solde/i,
    /solde\s+cr[eé]diteur/i,
    /solde\s+d[eé]biteur/i,
    /date\s+op/i,
    /lib[eé]ll[eé]/i,
  ];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip header/total/balance lines
    if (skipPatterns.some(p => p.test(trimmed))) continue;

    const dateMatch = trimmed.match(datePattern);
    if (!dateMatch) continue;

    const date = dateMatch[1];

    // Remove the leading date(s) — there may be two (date opé + date valeur)
    let rest = trimmed.substring(dateMatch[0].length).trim();
    // Remove second date if present (e.g., "19.01 19.01 ...")
    const secondDate = rest.match(/^(\d{2}[\/\.]\d{2}(?:[\/\.]\d{2,4})?)\s+/);
    if (secondDate) {
      rest = rest.substring(secondDate[0].length).trim();
    }

    // Find all amounts in the remaining text
    const amounts: number[] = [];
    let match: RegExpExecArray | null;
    const amountRe = /(\d{1,3}(?:\s\d{3})*[.,]\d{2})/g;
    while ((match = amountRe.exec(rest)) !== null) {
      const val = parseFloat(match[1].replace(/\s/g, '').replace(',', '.'));
      if (!isNaN(val)) amounts.push(val);
    }

    if (amounts.length === 0) continue;

    // The amount is typically the last (or only) number
    const amount = amounts[amounts.length - 1];

    // Extract label: everything before the first amount occurrence
    const firstAmountMatch = rest.match(/\d{1,3}(?:\s\d{3})*[.,]\d{2}/);
    const label = firstAmountMatch
      ? rest.substring(0, firstAmountMatch.index).trim()
      : rest.trim();

    // Clean label: remove trailing special chars like ¨
    const cleanLabel = label.replace(/[¨þ]/g, '').trim();

    if (cleanLabel.length > 0 && amount > 0) {
      transactions.push({ date, label: cleanLabel, amount, raw: trimmed });
    }
  }

  return transactions;
}
