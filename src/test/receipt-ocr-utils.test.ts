import { describe, expect, it } from 'vitest';
import { extractAmountsFromReceiptText, extractDateFromReceiptText } from '@/lib/receipt-ocr-utils';
import { extractPersonalExpenseFromFilename } from '@/lib/reconciliation';

const leclercInvoiceText = `
SAS SODIREV
CENTRE LECLERC
FACTURE n° 0250011899
Date de facture: 15/12/25
ENCRE HP 305 NOIR+CL.
Montant TTC 26.94
Total 1 26.94
20%00 22.45 4.49 26.94 CB 26.94
`;

describe('receipt OCR utils', () => {
  it('detects the invoice total amount before intermediate amounts', () => {
    expect(extractAmountsFromReceiptText(leclercInvoiceText)[0]).toBe(26.94);
  });

  it('detects receipt dates with OCR spacing noise', () => {
    expect(extractDateFromReceiptText('Date 15 / 12 / 25\nNet à payer 26,94 €')).toBe('2025-12-15');
  });

  it('ignores generic phone photo filenames for personal expenses', () => {
    expect(extractPersonalExpenseFromFilename('IMG_20260317_143355.jpg')).toBeNull();
  });

  it('keeps meaningful filenames as personal expense fallbacks', () => {
    expect(extractPersonalExpenseFromFilename('restaurant-comptoir-42,50-2026-03-17.jpg')).toMatchObject({
      merchant: 'Restaurant comptoir',
      amount: 42.5,
      date: '2026-03-17',
    });
  });
});
