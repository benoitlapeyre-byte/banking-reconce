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

function getReceiptName(tx: Transaction, receipts: Receipt[]): string {
  if (tx.validationComment) return `Non applicable: ${tx.validationComment}`;
  if (tx.receiptId) {
    const r = receipts.find(rc => rc.id === tx.receiptId);
    return r?.name || 'Oui';
  }
  const linked = receipts.find(r => r.linkedTransactionId === tx.id);
  return linked?.name || '';
}

function getExpenseReceiptName(exp: PersonalExpense, receipts: Receipt[]): string {
  if (!exp.receiptId) return '';
  const r = receipts.find(rc => rc.id === exp.receiptId);
  return r?.name || '';
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
    Commentaire: tx.validationComment || '',
    Note: tx.reconciliationNote || '',
    Relevé: tx.statementSource || '',
  }));
  const txSheet = XLSX.utils.json_to_sheet(txRows);
  txSheet['!cols'] = [
    { wch: 12 }, { wch: 40 }, { wch: 14 }, { wch: 14 },
    { wch: 16 }, { wch: 30 }, { wch: 30 }, { wch: 40 }, { wch: 25 },
  ];
  XLSX.utils.book_append_sheet(wb, txSheet, 'Transactions');

  // Personal expenses sheet
  if (data.personalExpenses.length > 0) {
    const peRows = data.personalExpenses.map(e => ({
      Date: e.date,
      Marchand: e.merchant,
      Montant: e.amount,
      Justificatif: getExpenseReceiptName(e, data.receipts),
      Note: e.note || '',
    }));
    const peSheet = XLSX.utils.json_to_sheet(peRows);
    peSheet['!cols'] = [{ wch: 12 }, { wch: 30 }, { wch: 14 }, { wch: 30 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, peSheet, 'Dépenses personnelles');
  }

  // Summary sheet
  const totalDebit = data.transactions.filter(t => t.type === 'debit').reduce((s, t) => s + t.amount, 0);
  const totalCredit = data.transactions.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0);
  const matched = data.transactions.filter(t => t.status === 'matched' || t.status === 'auto-matched').length;
  const pending = data.transactions.filter(t => t.status === 'pending').length;
  const totalPersonal = data.personalExpenses.reduce((s, e) => s + e.amount, 0);
  const summaryRows = [
    { Indicateur: 'Période', Valeur: label },
    { Indicateur: 'Total transactions', Valeur: data.transactions.length },
    { Indicateur: 'Total débits', Valeur: `${totalDebit.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €` },
    { Indicateur: 'Total crédits', Valeur: `${totalCredit.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €` },
    { Indicateur: 'Solde net', Valeur: `${(totalCredit - totalDebit).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €` },
    { Indicateur: 'Transactions justifiées', Valeur: matched },
    { Indicateur: 'En attente', Valeur: pending },
    { Indicateur: 'Taux de réconciliation', Valeur: data.transactions.length > 0 ? `${Math.round(matched / data.transactions.length * 100)}%` : 'N/A' },
    { Indicateur: 'Dépenses personnelles', Valeur: data.personalExpenses.length },
    { Indicateur: 'Total dépenses perso.', Valeur: `${totalPersonal.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €` },
    { Indicateur: 'Justificatifs importés', Valeur: data.receipts.length },
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
              const statusRaw = String(row['Statut'] || '').toLowerCase();
              let status: Transaction['status'] = 'pending';
              if (statusRaw.includes('auto')) status = 'auto-matched';
              else if (statusRaw.includes('justif') || statusRaw.includes('rapproch')) status = 'matched';

              transactions.push({
                id: crypto.randomUUID(),
                date: String(row['Date'] || ''),
                label: String(row['Libellé'] || ''),
                amount,
                type: credit > 0 ? 'credit' : 'debit',
                status,
                raw: `Import Excel: ${row['Libellé']}`,
                reconciliationNote: String(row['Note'] || '') || undefined,
                validationComment: String(row['Commentaire'] || '') || undefined,
                statementSource: String(row['Relevé'] || '') || undefined,
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
                note: String(row['Note'] || '') || undefined,
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
  const totalPersonal = data.personalExpenses.reduce((s, e) => s + e.amount, 0);

  doc.setFontSize(9);
  doc.text([
    `Transactions: ${data.transactions.length}  |  Débits: ${totalDebit.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €  |  Crédits: ${totalCredit.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €  |  Réconciliation: ${rate}%`,
    `Dépenses personnelles: ${data.personalExpenses.length}  |  Total: ${totalPersonal.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €  |  Justificatifs: ${data.receipts.length}`,
  ], 14, 23);

  // Transactions table
  autoTable(doc, {
    startY: 32,
    head: [['Date', 'Libellé', 'Débit', 'Crédit', 'Statut', 'Justificatif', 'Commentaire', 'Relevé']],
    body: data.transactions.map(tx => [
      tx.date,
      tx.label.substring(0, 45),
      tx.type === 'debit' ? `${tx.amount.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €` : '',
      tx.type === 'credit' ? `${tx.amount.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €` : '',
      statusLabel(tx.status),
      getReceiptName(tx, data.receipts) ? '✓' : '✗',
      tx.validationComment?.substring(0, 30) || '',
      tx.statementSource?.substring(0, 20) || '',
    ]),
    styles: { fontSize: 6.5, cellPadding: 1.2 },
    headStyles: { fillColor: [34, 139, 34], fontSize: 6.5 },
    columnStyles: {
      0: { cellWidth: 20 },
      1: { cellWidth: 65 },
      2: { cellWidth: 24, halign: 'right' },
      3: { cellWidth: 24, halign: 'right' },
      4: { cellWidth: 24 },
      5: { cellWidth: 12 },
      6: { cellWidth: 45 },
      7: { cellWidth: 30 },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 5) {
        const val = String(data.cell.raw);
        data.cell.styles.textColor = val === '✗' ? [220, 50, 50] : [34, 139, 34];
      }
    },
  });

  // Personal expenses
  if (data.personalExpenses.length > 0) {
    doc.addPage();
    doc.setFontSize(14);
    doc.text('Dépenses personnelles', 14, 15);

    const totalExp = data.personalExpenses.reduce((s, e) => s + e.amount, 0);
    doc.setFontSize(9);
    doc.text(`Total: ${totalExp.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €  |  ${data.personalExpenses.length} dépense(s)`, 14, 22);

    autoTable(doc, {
      startY: 27,
      head: [['Date', 'Marchand', 'Montant', 'Justificatif', 'Note']],
      body: data.personalExpenses.map(e => [
        e.date,
        e.merchant,
        `${e.amount.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`,
        getExpenseReceiptName(e, data.receipts) || '—',
        e.note || '',
      ]),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [34, 139, 34] },
      columnStyles: {
        0: { cellWidth: 25 },
        1: { cellWidth: 50 },
        2: { cellWidth: 30, halign: 'right' },
        3: { cellWidth: 50 },
        4: { cellWidth: 70 },
      },
    });
  }

  doc.save(`reconciliation_${label.replace(/\//g, '-')}.pdf`);
}
