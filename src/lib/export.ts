import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Transaction, PersonalExpense, Receipt } from './types';

interface ExportData {
  transactions: Transaction[];
  personalExpenses: PersonalExpense[];
  receipts: Receipt[];
  month?: string; // YYYY-MM
}

function formatAmount(amount: number, type: 'credit' | 'debit'): string {
  const prefix = type === 'debit' ? '-' : '+';
  return `${prefix}${amount.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`;
}

function getReceiptName(tx: Transaction, receipts: Receipt[]): string {
  if (tx.receiptId) {
    const r = receipts.find(rc => rc.id === tx.receiptId);
    return r?.name || 'Oui';
  }
  const linked = receipts.find(r => r.linkedTransactionId === tx.id);
  return linked?.name || '';
}

function statusLabel(status: string): string {
  switch (status) {
    case 'pending': return 'En attente';
    case 'matched': return 'Justifié';
    case 'auto-matched': return 'Auto-rapproché';
    case 'personal': return 'Personnel';
    default: return status;
  }
}

// ─── Excel Export ───
export function exportToExcel(data: ExportData) {
  const wb = XLSX.utils.book_new();
  const label = data.month || 'Complet';

  // Transactions sheet
  const txRows = data.transactions.map(tx => ({
    Date: tx.date,
    Libellé: tx.label,
    Débit: tx.type === 'debit' ? tx.amount : '',
    Crédit: tx.type === 'credit' ? tx.amount : '',
    Statut: statusLabel(tx.status),
    Justificatif: getReceiptName(tx, data.receipts) || 'Non',
    Note: tx.reconciliationNote || '',
  }));
  const txSheet = XLSX.utils.json_to_sheet(txRows);
  txSheet['!cols'] = [{ wch: 12 }, { wch: 40 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 30 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, txSheet, 'Transactions');

  // Personal expenses sheet
  if (data.personalExpenses.length > 0) {
    const peRows = data.personalExpenses.map(e => ({
      Date: e.date,
      Marchand: e.merchant,
      Montant: e.amount,
      Note: e.note || '',
    }));
    const peSheet = XLSX.utils.json_to_sheet(peRows);
    peSheet['!cols'] = [{ wch: 12 }, { wch: 30 }, { wch: 14 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, peSheet, 'Dépenses personnelles');
  }

  // Summary sheet
  const totalDebit = data.transactions.filter(t => t.type === 'debit').reduce((s, t) => s + t.amount, 0);
  const totalCredit = data.transactions.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0);
  const matched = data.transactions.filter(t => t.status === 'matched' || t.status === 'auto-matched').length;
  const summaryRows = [
    { Indicateur: 'Période', Valeur: label },
    { Indicateur: 'Total transactions', Valeur: data.transactions.length },
    { Indicateur: 'Total débits', Valeur: totalDebit },
    { Indicateur: 'Total crédits', Valeur: totalCredit },
    { Indicateur: 'Solde net', Valeur: totalCredit - totalDebit },
    { Indicateur: 'Transactions justifiées', Valeur: matched },
    { Indicateur: 'En attente', Valeur: data.transactions.length - matched },
    { Indicateur: 'Taux de réconciliation', Valeur: data.transactions.length > 0 ? `${Math.round(matched / data.transactions.length * 100)}%` : 'N/A' },
  ];
  const sumSheet = XLSX.utils.json_to_sheet(summaryRows);
  sumSheet['!cols'] = [{ wch: 28 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, sumSheet, 'Résumé');

  XLSX.writeFile(wb, `reconciliation_${label.replace(/\//g, '-')}.xlsx`);
}

// ─── Excel Import ───
export function importFromExcel(file: File): Promise<{ transactions: Transaction[]; personalExpenses: PersonalExpense[] }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });

        const transactions: Transaction[] = [];
        const personalExpenses: PersonalExpense[] = [];

        const txSheet = wb.Sheets['Transactions'];
        if (txSheet) {
          const rows = XLSX.utils.sheet_to_json<any>(txSheet);
          for (const row of rows) {
            const debit = parseFloat(String(row['Débit'] || '0').replace(/[^\d.,]/g, '').replace(',', '.'));
            const credit = parseFloat(String(row['Crédit'] || '0').replace(/[^\d.,]/g, '').replace(',', '.'));
            const amount = debit || credit;
            if (amount > 0) {
              transactions.push({
                id: crypto.randomUUID(),
                date: String(row['Date'] || ''),
                label: String(row['Libellé'] || ''),
                amount,
                type: credit > 0 ? 'credit' : 'debit',
                status: 'pending',
                raw: `Import Excel: ${row['Libellé']}`,
              });
            }
          }
        }

        const peSheet = wb.Sheets['Dépenses personnelles'];
        if (peSheet) {
          const rows = XLSX.utils.sheet_to_json<any>(peSheet);
          for (const row of rows) {
            const amount = parseFloat(String(row['Montant'] || '0').replace(/[^\d.,]/g, '').replace(',', '.'));
            if (amount > 0) {
              personalExpenses.push({
                id: crypto.randomUUID(),
                date: String(row['Date'] || ''),
                merchant: String(row['Marchand'] || ''),
                amount,
                note: String(row['Note'] || ''),
                createdAt: new Date().toISOString(),
              });
            }
          }
        }

        resolve({ transactions, personalExpenses });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// ─── PDF Export ───
export function exportToPDF(data: ExportData) {
  const doc = new jsPDF('landscape', 'mm', 'a4');
  const label = data.month || 'Complet';

  // Title
  doc.setFontSize(16);
  doc.text(`Rapport de réconciliation — ${label}`, 14, 15);

  // Summary
  const totalDebit = data.transactions.filter(t => t.type === 'debit').reduce((s, t) => s + t.amount, 0);
  const totalCredit = data.transactions.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0);
  const matched = data.transactions.filter(t => t.status === 'matched' || t.status === 'auto-matched').length;
  const rate = data.transactions.length > 0 ? Math.round(matched / data.transactions.length * 100) : 0;

  doc.setFontSize(9);
  doc.text([
    `Transactions: ${data.transactions.length}  |  Débits: ${totalDebit.toLocaleString('fr-FR')} €  |  Crédits: ${totalCredit.toLocaleString('fr-FR')} €  |  Taux réconciliation: ${rate}%`
  ], 14, 23);

  // Transactions table
  autoTable(doc, {
    startY: 28,
    head: [['Date', 'Libellé', 'Débit', 'Crédit', 'Statut', 'Justificatif']],
    body: data.transactions.map(tx => [
      tx.date,
      tx.label.substring(0, 50),
      tx.type === 'debit' ? `${tx.amount.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €` : '',
      tx.type === 'credit' ? `${tx.amount.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €` : '',
      statusLabel(tx.status),
      getReceiptName(tx, data.receipts) ? '✓ Oui' : '✗ Non',
    ]),
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [34, 139, 34], fontSize: 7 },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 80 },
      2: { cellWidth: 28, halign: 'right' },
      3: { cellWidth: 28, halign: 'right' },
      4: { cellWidth: 30 },
      5: { cellWidth: 25 },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 5) {
        const val = String(data.cell.raw);
        if (val.startsWith('✗')) {
          data.cell.styles.textColor = [220, 50, 50];
        } else {
          data.cell.styles.textColor = [34, 139, 34];
        }
      }
    },
  });

  // Personal expenses on new page if any
  if (data.personalExpenses.length > 0) {
    doc.addPage();
    doc.setFontSize(14);
    doc.text('Dépenses personnelles', 14, 15);

    autoTable(doc, {
      startY: 22,
      head: [['Date', 'Marchand', 'Montant', 'Note']],
      body: data.personalExpenses.map(e => [
        e.date,
        e.merchant,
        `${e.amount.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`,
        e.note || '',
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [34, 139, 34] },
    });
  }

  doc.save(`reconciliation_${label.replace(/\//g, '-')}.pdf`);
}
