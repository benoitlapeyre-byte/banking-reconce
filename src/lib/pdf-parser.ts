// @ts-ignore - pdfjs-dist types have internal TS issues
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs`;

interface TextItem {
  str: string;
  x: number;
  y: number;
}

interface StructuredLine {
  y: number;
  items: TextItem[];
  text: string;
}

export async function extractStructuredLines(file: File): Promise<StructuredLine[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const allLines: StructuredLine[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();

    const itemsByY: Map<number, TextItem[]> = new Map();
    const Y_TOLERANCE = 3;

    for (const item of content.items) {
      if (!('str' in item) || !(item as any).transform) continue;
      const textItem = item as { str: string; transform: number[] };
      if (!textItem.str.trim() && !textItem.str.includes(' ')) continue;

      const x = textItem.transform[4];
      const y = Math.round(textItem.transform[5]);

      let foundY: number | null = null;
      for (const existingY of itemsByY.keys()) {
        if (Math.abs(existingY - y) <= Y_TOLERANCE) {
          foundY = existingY;
          break;
        }
      }

      const bucketY = foundY ?? y;
      if (!itemsByY.has(bucketY)) itemsByY.set(bucketY, []);
      itemsByY.get(bucketY)!.push({ str: textItem.str, x, y });
    }

    const sortedYs = [...itemsByY.keys()].sort((a, b) => b - a);

    for (const y of sortedYs) {
      const items = itemsByY.get(y)!;
      items.sort((a, b) => a.x - b.x);

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
        allLines.push({ y, items, text: trimmed });
      }
    }
  }

  console.log('[PDF Parser] Extracted lines:', allLines.map(l => l.text));
  return allLines;
}

// Detect debit/credit column X positions from header
function detectColumns(lines: StructuredLine[]): { debitX: number; creditX: number } | null {
  for (const line of lines) {
    const debitItem = line.items.find(it => /d[eé]bit/i.test(it.str));
    const creditItem = line.items.find(it => /cr[eé]dit/i.test(it.str));
    if (debitItem && creditItem) {
      console.log('[PDF Parser] Detected columns - Débit X:', debitItem.x, 'Crédit X:', creditItem.x);
      return { debitX: debitItem.x, creditX: creditItem.x };
    }
  }
  return null;
}

export type ParsedTransaction = {
  date: string;
  label: string;
  amount: number;
  type: 'credit' | 'debit';
  raw: string;
};

export function parseTransactionsFromLines(lines: StructuredLine[]): ParsedTransaction[] {
  const columns = detectColumns(lines);
  const transactions: ParsedTransaction[] = [];

  const datePattern = /^(\d{2}[\/\.]\d{2}(?:[\/\.]\d{2,4})?)/;
  const amountPattern = /(\d{1,3}(?:\s\d{3})*[.,]\d{2})/g;

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
    const trimmed = line.text.trim();
    if (skipPatterns.some(p => p.test(trimmed))) continue;

    const dateMatch = trimmed.match(datePattern);
    if (!dateMatch) continue;

    const date = dateMatch[1];

    let rest = trimmed.substring(dateMatch[0].length).trim();
    const secondDate = rest.match(/^(\d{2}[\/\.]\d{2}(?:[\/\.]\d{2,4})?)\s+/);
    if (secondDate) {
      rest = rest.substring(secondDate[0].length).trim();
    }

    // Find amounts in remaining text
    const amounts: number[] = [];
    let match: RegExpExecArray | null;
    const amountRe = /(\d{1,3}(?:\s\d{3})*[.,]\d{2})/g;
    while ((match = amountRe.exec(rest)) !== null) {
      const val = parseFloat(match[1].replace(/\s/g, '').replace(',', '.'));
      if (!isNaN(val)) amounts.push(val);
    }

    if (amounts.length === 0) continue;

    const amount = amounts[amounts.length - 1];

    // Determine type from column position
    let type: 'credit' | 'debit' = 'debit'; // default
    if (columns) {
      // Find the text item containing the amount value
      const amountStr = amounts[amounts.length - 1].toString().replace('.', ',');
      const COLUMN_TOLERANCE = 80;
      
      for (const item of line.items) {
        const cleanStr = item.str.replace(/\s/g, '');
        if (cleanStr.includes(amountStr.replace(/\s/g, '')) || 
            /\d/.test(cleanStr) && Math.abs(item.x - columns.creditX) < COLUMN_TOLERANCE) {
          // Check if this numeric item is closer to credit or debit column
          const distToDebit = Math.abs(item.x - columns.debitX);
          const distToCredit = Math.abs(item.x - columns.creditX);
          if (/\d{2,}/.test(cleanStr) && distToCredit < distToDebit) {
            type = 'credit';
          }
        }
      }

      // More reliable: check X position of rightmost numeric items
      const numericItems = line.items.filter(it => /\d{1,3}(?:\s?\d{3})*[.,]\d{2}/.test(it.str.replace(/\s/g, '')) || /^\d[\d\s]*$/.test(it.str.trim()));
      if (numericItems.length > 0) {
        // Get the rightmost cluster of numeric items (the amount)
        const rightmostNumeric = numericItems.reduce((max, it) => it.x > max.x ? it : max, numericItems[0]);
        const distToDebit = Math.abs(rightmostNumeric.x - columns.debitX);
        const distToCredit = Math.abs(rightmostNumeric.x - columns.creditX);
        type = distToCredit < distToDebit ? 'credit' : 'debit';
      }
    }

    // Extract label
    const firstAmountMatch = rest.match(/\d{1,3}(?:\s\d{3})*[.,]\d{2}/);
    const label = firstAmountMatch
      ? rest.substring(0, firstAmountMatch.index).trim()
      : rest.trim();

    const cleanLabel = label.replace(/[¨þ]/g, '').trim();

    if (cleanLabel.length > 0 && amount > 0) {
      transactions.push({ date, label: cleanLabel, amount, type, raw: trimmed });
    }
  }

  console.log('[PDF Parser] Parsed transactions:', transactions);
  return transactions;
}

// Legacy wrapper for backward compatibility
export async function extractTextFromPDF(file: File): Promise<string> {
  const lines = await extractStructuredLines(file);
  return lines.map(l => l.text).join('\n');
}

export function parseTransactions(text: string): Array<{
  date: string;
  label: string;
  amount: number;
  raw: string;
}> {
  // This is the legacy function - new code should use parseTransactionsFromLines
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  return parseTransactionsFromLines(lines.map((text, i) => ({
    y: i,
    items: [{ str: text, x: 0, y: i }],
    text,
  })));
}
