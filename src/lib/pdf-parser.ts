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
      .filter(item => 'str' in item)
      .map(item => (item as { str: string }).str);
    fullText += strings.join(' ') + '\n';
  }

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

  // Amount pattern: handles space-separated thousands like "1 170,00" or "847,12"
  // Captures amounts that may appear anywhere on the line
  const amountPattern = /(\d[\d\s]*[.,]\d{2})/g;

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
    const amountRe = /(\d[\d\s]*[.,]\d{2})/g;
    while ((match = amountRe.exec(rest)) !== null) {
      const val = parseFloat(match[1].replace(/\s/g, '').replace(',', '.'));
      if (!isNaN(val)) amounts.push(val);
    }

    if (amounts.length === 0) continue;

    // The amount is typically the last (or only) number
    const amount = amounts[amounts.length - 1];

    // Extract label: everything before the first amount occurrence
    const firstAmountMatch = rest.match(/\d[\d\s]*[.,]\d{2}/);
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
