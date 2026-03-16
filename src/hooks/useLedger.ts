import { useState, useCallback, useEffect, useMemo } from 'react';
import { Transaction, Receipt, PersonalExpense, FilterStatus } from '@/lib/types';
import { loadTransactions, saveTransactions, loadPersonalExpenses, savePersonalExpenses, generateId } from '@/lib/store';
import { extractStructuredLines, parseTransactionsFromLines } from '@/lib/pdf-parser';
import { autoReconcile, extractPersonalExpenseFromFilename } from '@/lib/reconciliation';
import { scanReceiptForAmounts } from '@/lib/receipt-scanner';
import { toast } from 'sonner';

export function useLedger() {
  const [transactions, setTransactions] = useState<Transaction[]>(() => loadTransactions());
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [personalExpenses, setPersonalExpenses] = useState<PersonalExpense[]>(() => loadPersonalExpenses());
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);

  useEffect(() => { saveTransactions(transactions); }, [transactions]);
  useEffect(() => { savePersonalExpenses(personalExpenses); }, [personalExpenses]);

  // Extract available months from transactions
  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    for (const tx of transactions) {
      // Parse date in format DD/MM/YYYY or DD.MM.YYYY
      const m = tx.date.match(/(\d{2})[\/.](\d{2})[\/.](\d{2,4})/);
      if (m) {
        const year = m[3].length === 2 ? `20${m[3]}` : m[3];
        months.add(`${year}-${m[2]}`);
      }
      // ISO format YYYY-MM-DD
      const iso = tx.date.match(/^(\d{4})-(\d{2})/);
      if (iso) months.add(`${iso[1]}-${iso[2]}`);
    }
    return [...months].sort();
  }, [transactions]);

  const importStatement = useCallback(async (file: File) => {
    setIsProcessing(true);
    try {
      const lines = await extractStructuredLines(file);
      const parsed = parseTransactionsFromLines(lines);
      const newTxs: Transaction[] = parsed.map(t => ({
        id: generateId(),
        date: t.date,
        label: t.label,
        amount: t.amount,
        type: t.type,
        status: 'pending',
        raw: t.raw,
      }));
      setTransactions(prev => [...prev, ...newTxs]);
      return newTxs.length;
    } catch (e) {
      console.error('PDF parsing error:', e);
      return 0;
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const addReceipt = useCallback((file: File) => {
    const receipt: Receipt = {
      id: generateId(),
      name: file.name,
      file,
      thumbnailUrl: URL.createObjectURL(file),
      createdAt: new Date().toISOString(),
    };
    setReceipts(prev => [...prev, receipt]);
    return receipt;
  }, []);

  const addReceiptWithAutoReconcile = useCallback(async (file: File): Promise<'matched' | 'personal-auto' | 'unrecognized'> => {
    const receipt: Receipt = {
      id: generateId(),
      name: file.name,
      file,
      thumbnailUrl: URL.createObjectURL(file),
      createdAt: new Date().toISOString(),
    };

    setReceipts(prev => [...prev, receipt]);

    // Scan file content for amounts (OCR for images, text extraction for PDFs)
    toast.info(`🔍 Analyse du justificatif ${file.name}...`);
    let scannedAmounts: number[] = [];
    try {
      scannedAmounts = await scanReceiptForAmounts(file);
      if (scannedAmounts.length > 0) {
        console.log(`[Receipt] Scanned amounts from ${file.name}:`, scannedAmounts);
        toast.info(`Montants détectés: ${scannedAmounts.map(a => a.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })).join(', ')}`);
      }
    } catch (e) {
      console.error('[Receipt] OCR scan failed:', e);
    }

    let bankMatchResult: ReturnType<typeof autoReconcile> | null = null;

    setTransactions(prev => {
      const result = autoReconcile(receipt, prev, scannedAmounts);
      bankMatchResult = result;

      if (result.transactionId && result.confidence === 'high') {
        receipt.linkedTransactionId = result.transactionId;
        setReceipts(r => r.map(rc =>
          rc.id === receipt.id ? { ...rc, linkedTransactionId: result.transactionId! } : rc
        ));
        toast.success(`✅ Auto-rapproché: ${file.name}`, { description: result.note });
        return prev.map(t =>
          t.id === result.transactionId
            ? { ...t, status: 'auto-matched' as const, receiptId: receipt.id, reconciliationNote: result.note }
            : t
        );
      } else if (result.transactionId && result.confidence === 'medium') {
        toast.info(`🔍 Correspondance probable pour ${file.name}`, { description: result.note + ' — Cliquez sur la transaction pour confirmer.' });
        return prev.map(t =>
          t.id === result.transactionId
            ? { ...t, reconciliationNote: result.note }
            : t
        );
      }
      return prev;
    });

    if (bankMatchResult && (bankMatchResult as any).confidence !== 'none') {
      return 'matched';
    }

    const expenseInfo = extractPersonalExpenseFromFilename(file.name);
    if (expenseInfo && expenseInfo.amount && expenseInfo.merchant) {
      const newExpense: PersonalExpense = {
        id: generateId(),
        merchant: expenseInfo.merchant,
        amount: expenseInfo.amount,
        date: expenseInfo.date || new Date().toISOString().slice(0, 10),
        receiptId: receipt.id,
        note: 'Auto-détecté depuis le justificatif',
        createdAt: new Date().toISOString(),
      };
      setPersonalExpenses(prev => [...prev, newExpense]);
      toast.success(`💰 Dépense personnelle détectée: ${newExpense.merchant}`, {
        description: `${newExpense.amount.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })} — ${newExpense.date}`,
      });
      return 'personal-auto';
    }

    toast.warning(`⚠️ ${file.name}: non reconnu`, {
      description: 'Aucune correspondance bancaire ni dépense personnelle détectée. Ajoutez manuellement.',
    });
    return 'unrecognized';
  }, []);

  const linkReceiptToTransaction = useCallback((receiptId: string, transactionId: string) => {
    setReceipts(prev => prev.map(r =>
      r.id === receiptId ? { ...r, linkedTransactionId: transactionId } : r
    ));
    setTransactions(prev => prev.map(t =>
      t.id === transactionId ? { ...t, status: 'matched' as const, receiptId, reconciliationNote: 'Rapprochement manuel' } : t
    ));
  }, []);

  const unlinkReceipt = useCallback((transactionId: string) => {
    setTransactions(prev => prev.map(t =>
      t.id === transactionId ? { ...t, status: 'pending' as const, receiptId: undefined, reconciliationNote: undefined } : t
    ));
    setReceipts(prev => prev.map(r =>
      r.linkedTransactionId === transactionId ? { ...r, linkedTransactionId: undefined } : r
    ));
  }, []);

  const addPersonalExpense = useCallback((expense: Omit<PersonalExpense, 'id' | 'createdAt'>) => {
    const newExpense: PersonalExpense = {
      ...expense,
      id: generateId(),
      createdAt: new Date().toISOString(),
    };
    setPersonalExpenses(prev => [...prev, newExpense]);
    return newExpense;
  }, []);

  const removeTransaction = useCallback((id: string) => {
    setTransactions(prev => prev.filter(t => t.id !== id));
    setReceipts(prev => prev.map(r =>
      r.linkedTransactionId === id ? { ...r, linkedTransactionId: undefined } : r
    ));
  }, []);

  const removePersonalExpense = useCallback((id: string) => {
    setPersonalExpenses(prev => prev.filter(e => e.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setTransactions([]);
    setReceipts([]);
    setPersonalExpenses([]);
    localStorage.clear();
  }, []);

  const importFromExcelData = useCallback((data: { transactions: Transaction[]; personalExpenses: PersonalExpense[] }) => {
    setTransactions(prev => [...prev, ...data.transactions]);
    setPersonalExpenses(prev => [...prev, ...data.personalExpenses]);
  }, []);

  // Filter by month
  const monthFiltered = useMemo(() => {
    if (!selectedMonth) return transactions;
    return transactions.filter(tx => {
      const m = tx.date.match(/(\d{2})[\/.](\d{2})[\/.](\d{2,4})/);
      if (m) {
        const year = m[3].length === 2 ? `20${m[3]}` : m[3];
        return `${year}-${m[2]}` === selectedMonth;
      }
      const iso = tx.date.match(/^(\d{4})-(\d{2})/);
      if (iso) return `${iso[1]}-${iso[2]}` === selectedMonth;
      return false;
    });
  }, [transactions, selectedMonth]);

  // Filter by status/type
  const filteredTransactions = monthFiltered.filter(t => {
    if (filter === 'all') return true;
    if (filter === 'credit') return t.type === 'credit';
    if (filter === 'debit') return t.type === 'debit';
    if (filter === 'matched') return t.status === 'matched' || t.status === 'auto-matched';
    return t.status === filter;
  });

  const stats = {
    total: monthFiltered.length,
    pending: monthFiltered.filter(t => t.status === 'pending').length,
    matched: monthFiltered.filter(t => t.status === 'matched' || t.status === 'auto-matched').length,
    autoMatched: monthFiltered.filter(t => t.status === 'auto-matched').length,
    personal: personalExpenses.length,
    credit: monthFiltered.filter(t => t.type === 'credit').length,
    debit: monthFiltered.filter(t => t.type === 'debit').length,
    creditAmount: monthFiltered.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0),
    debitAmount: monthFiltered.filter(t => t.type === 'debit').reduce((s, t) => s + t.amount, 0),
    pendingAmount: monthFiltered.filter(t => t.status === 'pending').reduce((s, t) => s + t.amount, 0),
    unmatchedReceipts: receipts.filter(r => !r.linkedTransactionId).length,
  };

  return {
    transactions: filteredTransactions,
    allTransactions: transactions,
    monthFilteredTransactions: monthFiltered,
    receipts,
    personalExpenses,
    filter,
    setFilter,
    selectedMonth,
    setSelectedMonth,
    availableMonths,
    isProcessing,
    selectedTransaction,
    setSelectedTransaction,
    importStatement,
    addReceipt,
    addReceiptWithAutoReconcile,
    linkReceiptToTransaction,
    unlinkReceipt,
    addPersonalExpense,
    removeTransaction,
    removePersonalExpense,
    clearAll,
    importFromExcelData,
    stats,
  };
}
