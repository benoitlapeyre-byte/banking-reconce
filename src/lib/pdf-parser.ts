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
    const strings = content.items
      .filter((item): item is { str: string } => 'str' in item)
      .map(item => item.str);
    fullText += strings.join(' ') + '\n';
  }

  return fullText;
}

// Simple heuristic parser for bank statement lines
// Matches patterns like: DD/MM/YYYY LABEL AMOUNT
export function parseTransactions(text: string): Array<{
  date: string;
  label: string;
  amount: number;
  raw: string;
}> {
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  const transactions: Array<{ date: string; label: string; amount: number; raw: string }> = [];

  // Pattern: date (DD/MM/YYYY or DD.MM.YYYY) ... amount (with comma or dot as decimal)
  const datePattern = /(\d{2}[\/\.]\d{2}[\/\.]\d{2,4})/;
  const amountPattern = /(-?\s*\d[\d\s]*[.,]\d{2})\s*$/;

  for (const line of lines) {
    const dateMatch = line.match(datePattern);
    const amountMatch = line.match(amountPattern);

    if (dateMatch && amountMatch) {
      const date = dateMatch[1];
      const amountStr = amountMatch[1].replace(/\s/g, '').replace(',', '.');
      const amount = parseFloat(amountStr);

      if (!isNaN(amount)) {
        // Extract label between date and amount
        const dateEnd = line.indexOf(dateMatch[0]) + dateMatch[0].length;
        const amountStart = line.lastIndexOf(amountMatch[1]);
        const label = line.substring(dateEnd, amountStart).trim();

        if (label.length > 0) {
          transactions.push({ date, label, amount, raw: line.trim() });
        }
      }
    }
  }

  return transactions;
}
