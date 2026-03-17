import { useState, useCallback, useEffect, useMemo } from 'react';
import { Transaction, Receipt, PersonalExpense, FilterStatus } from '@/lib/types';
import { loadTransactions, saveTransactions, loadPersonalExpenses, savePersonalExpenses, generateId } from '@/lib/store';
import { extractStructuredLines, parseTransactionsFromLines } from '@/lib/pdf-parser';
import { autoReconcile, extractPersonalExpenseFromFilename } from '@/lib/reconciliation';
import { scanReceiptForAmounts, ScanProgress } from '@/lib/receipt-scanner';
import { toast } from 'sonner';

export function useLedger() {
  const [transactions, setTransactions] = useState<Transaction[]>(() => loadTransactions());
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [personalExpenses, setPersonalExpenses] = useState<PersonalExpense[]>(() => loadPersonalExpenses());
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);

  useEffect(() => { saveTransactions(transactions); }, [transactions]);
  useEffect(() => { savePersonalExpenses(personalExpenses); }, [personalExpenses]);

  const syncSelectedTransaction = useCallback((updated: Transaction | null) => {
    if (!updated) return;
    setSelectedTransaction((prev) => (prev?.id === updated.id ? updated : prev));
  }, []);

  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    for (const tx of transactions) {
      const m = tx.date.match(/(\d{2})[\/.](\d{2})[\/.](\d{2,4})/);
      if (m) {
        const year = m[3].length === 2 ? `20${m[3]}` : m[3];
        months.add(`${year}-${m[2]}`);
      }
      const iso = tx.date.match(/^(\d{4})-(\d{2})/);
      if (iso) months.add(`${iso[1]}-${iso[2]}`);
    }
    return [...months].sort();
  }, [transactions]);

  const statementSources = useMemo(() => {
    const sources = new Set<string>();
    for (const tx of transactions) {
      if (tx.statementSource) sources.add(tx.statementSource);
    }
    return [...sources].sort();
  }, [transactions]);

  const [selectedStatement, setSelectedStatement] = useState<string | null>(null);

  const importStatement = useCallback(async (file: File) => {
    setIsProcessing(true);
    try {
      const lines = await extractStructuredLines(file);
      const parsed = parseTransactionsFromLines(lines);
      const newTxs: Transaction[] = parsed.map((t) => ({
        id: generateId(),
        date: t.date,
        label: t.label,
        amount: t.amount,
        type: t.type,
        status: 'pending',
        raw: t.raw,
        statementSource: file.name,
      }));
      setTransactions((prev) => [...prev, ...newTxs]);
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
    setReceipts((prev) => [...prev, receipt]);
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

    setReceipts((prev) => [...prev, receipt]);

    let scannedAmounts: number[] = [];
    try {
      scannedAmounts = await scanReceiptForAmounts(file, (progress) => setScanProgress(progress));
      setScanProgress(null);
      if (scannedAmounts.length > 0) {
        console.log(`[Receipt] Scanned amounts from ${file.name}:`, scannedAmounts);
        toast.info(`Montants détectés: ${scannedAmounts.map((amount) => amount.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })).join(', ')}`);
      }
    } catch (e) {
      console.error('[Receipt] OCR scan failed:', e);
      setScanProgress(null);
    }

    let bankMatchResult: ReturnType<typeof autoReconcile> | null = null;

    setTransactions((prev) => {
      const result = autoReconcile(receipt, prev, scannedAmounts);
      bankMatchResult = result;

      if (result.transactionId && result.confidence === 'high') {
        receipt.linkedTransactionId = result.transactionId;
        setReceipts((currentReceipts) => currentReceipts.map((currentReceipt) =>
          currentReceipt.id === receipt.id ? { ...currentReceipt, linkedTransactionId: result.transactionId! } : currentReceipt
        ));

        toast.success(`✅ Auto-rapproché: ${file.name}`, { description: result.note });

        return prev.map((transaction) => {
          if (transaction.id !== result.transactionId) return transaction;
          const updated = {
            ...transaction,
            status: 'auto-matched' as const,
            receiptId: receipt.id,
            reconciliationNote: result.note,
            validationComment: undefined,
          };
          syncSelectedTransaction(updated);
          return updated;
        });
      }

      if (result.transactionId && result.confidence === 'medium') {
        toast.info(`🔍 Correspondance probable pour ${file.name}`, { description: `${result.note} — Cliquez sur la transaction pour confirmer.` });
        return prev.map((transaction) => {
          if (transaction.id !== result.transactionId) return transaction;
          const updated = { ...transaction, reconciliationNote: result.note };
          syncSelectedTransaction(updated);
          return updated;
        });
      }

      return prev;
    });

    if (bankMatchResult && bankMatchResult.confidence !== 'none') {
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
      setPersonalExpenses((prev) => [...prev, newExpense]);
      toast.success(`💰 Dépense personnelle détectée: ${newExpense.merchant}`, {
        description: `${newExpense.amount.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })} — ${newExpense.date}`,
      });
      return 'personal-auto';
    }

    toast.warning(`⚠️ ${file.name}: non reconnu`, {
      description: 'Aucune correspondance bancaire ni dépense personnelle détectée. Ajoutez manuellement.',
    });
    return 'unrecognized';
  }, [syncSelectedTransaction]);

  const linkReceiptToTransaction = useCallback((receiptId: string, transactionId: string) => {
    setReceipts((prev) => prev.map((receipt) =>
      receipt.id === receiptId ? { ...receipt, linkedTransactionId: transactionId } : receipt
    ));
    setTransactions((prev) => prev.map((transaction) => {
      if (transaction.id !== transactionId) return transaction;
      const updated = {
        ...transaction,
        status: 'matched' as const,
        receiptId,
        reconciliationNote: 'Rapprochement manuel',
        validationComment: undefined,
      };
      syncSelectedTransaction(updated);
      return updated;
    }));
  }, [syncSelectedTransaction]);

  const unlinkReceipt = useCallback((transactionId: string) => {
    setTransactions((prev) => prev.map((transaction) => {
      if (transaction.id !== transactionId) return transaction;
      const updated = {
        ...transaction,
        status: 'pending' as const,
        receiptId: undefined,
        reconciliationNote: undefined,
        validationComment: undefined,
      };
      syncSelectedTransaction(updated);
      return updated;
    }));
    setReceipts((prev) => prev.map((receipt) =>
      receipt.linkedTransactionId === transactionId ? { ...receipt, linkedTransactionId: undefined } : receipt
    ));
  }, [syncSelectedTransaction]);

  const validateTransactionWithoutReceipt = useCallback((transactionId: string, comment: string) => {
    const cleanComment = comment.trim();
    if (!cleanComment) return;

    setTransactions((prev) => prev.map((transaction) => {
      if (transaction.id !== transactionId) return transaction;
      const updated = {
        ...transaction,
        status: 'matched' as const,
        receiptId: undefined,
        validationComment: cleanComment,
      };
      syncSelectedTransaction(updated);
      return updated;
    }));

    setReceipts((prev) => prev.map((receipt) =>
      receipt.linkedTransactionId === transactionId ? { ...receipt, linkedTransactionId: undefined } : receipt
    ));

    toast.success('Transaction validée sans justificatif');
  }, [syncSelectedTransaction]);

  const addPersonalExpense = useCallback((expense: Omit<PersonalExpense, 'id' | 'createdAt'>) => {
    const newExpense: PersonalExpense = {
      ...expense,
      id: generateId(),
      createdAt: new Date().toISOString(),
    };
    setPersonalExpenses((prev) => [...prev, newExpense]);
    return newExpense;
  }, []);

  const removeTransaction = useCallback((id: string) => {
    setTransactions((prev) => prev.filter((transaction) => transaction.id !== id));
    setReceipts((prev) => prev.map((receipt) =>
      receipt.linkedTransactionId === id ? { ...receipt, linkedTransactionId: undefined } : receipt
    ));
    setSelectedTransaction((prev) => (prev?.id === id ? null : prev));
  }, []);

  const updatePersonalExpense = useCallback((id: string, updates: Partial<Pick<PersonalExpense, 'date' | 'merchant' | 'amount' | 'note'>>) => {
    setPersonalExpenses((prev) => prev.map((exp) =>
      exp.id === id ? { ...exp, ...updates } : exp
    ));
  }, []);

  const reconcileExpenseWithTransaction = useCallback((expenseId: string, transactionId: string) => {
    const expense = personalExpenses.find((e) => e.id === expenseId);
    if (!expense) return;

    // Link receipt if the expense has one
    if (expense.receiptId) {
      setReceipts((prev) => prev.map((r) =>
        r.id === expense.receiptId ? { ...r, linkedTransactionId: transactionId } : r
      ));
      setTransactions((prev) => prev.map((tx) => {
        if (tx.id !== transactionId) return tx;
        const updated = {
          ...tx,
          status: 'matched' as const,
          receiptId: expense.receiptId,
          reconciliationNote: `Réconcilié via dépense personnelle: ${expense.merchant}`,
          validationComment: undefined,
        };
        syncSelectedTransaction(updated);
        return updated;
      }));
    } else {
      setTransactions((prev) => prev.map((tx) => {
        if (tx.id !== transactionId) return tx;
        const updated = {
          ...tx,
          status: 'matched' as const,
          validationComment: `Dépense personnelle: ${expense.merchant} — ${expense.amount.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}`,
        };
        syncSelectedTransaction(updated);
        return updated;
      }));
    }

    // Remove the personal expense since it's now reconciled
    setPersonalExpenses((prev) => prev.filter((e) => e.id !== expenseId));
    toast.success(`Dépense réconciliée avec l'opération bancaire`);
  }, [personalExpenses, syncSelectedTransaction]);

  const removePersonalExpense = useCallback((id: string) => {
    setPersonalExpenses((prev) => prev.filter((expense) => expense.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setTransactions([]);
    setReceipts([]);
    setPersonalExpenses([]);
    setSelectedTransaction(null);
    localStorage.clear();
  }, []);

  const importFromExcelData = useCallback((data: { transactions: Transaction[]; personalExpenses: PersonalExpense[] }) => {
    setTransactions((prev) => [...prev, ...data.transactions]);
    setPersonalExpenses((prev) => [...prev, ...data.personalExpenses]);
  }, []);

  const statementFiltered = useMemo(() => {
    if (!selectedStatement) return transactions;
    return transactions.filter((tx) => tx.statementSource === selectedStatement);
  }, [transactions, selectedStatement]);

  const monthFiltered = useMemo(() => {
    if (!selectedMonth) return statementFiltered;
    return statementFiltered.filter((tx) => {
      const m = tx.date.match(/(\d{2})[\/.](\d{2})[\/.](\d{2,4})/);
      if (m) {
        const year = m[3].length === 2 ? `20${m[3]}` : m[3];
        return `${year}-${m[2]}` === selectedMonth;
      }
      const iso = tx.date.match(/^(\d{4})-(\d{2})/);
      if (iso) return `${iso[1]}-${iso[2]}` === selectedMonth;
      return false;
    });
  }, [statementFiltered, selectedMonth]);

  const filteredTransactions = monthFiltered.filter((transaction) => {
    if (filter === 'all') return true;
    if (filter === 'credit') return transaction.type === 'credit';
    if (filter === 'debit') return transaction.type === 'debit';
    if (filter === 'matched') return transaction.status === 'matched' || transaction.status === 'auto-matched';
    return transaction.status === filter;
  });

  const stats = {
    total: monthFiltered.length,
    pending: monthFiltered.filter((transaction) => transaction.status === 'pending').length,
    matched: monthFiltered.filter((transaction) => transaction.status === 'matched' || transaction.status === 'auto-matched').length,
    autoMatched: monthFiltered.filter((transaction) => transaction.status === 'auto-matched').length,
    personal: personalExpenses.length,
    credit: monthFiltered.filter((transaction) => transaction.type === 'credit').length,
    debit: monthFiltered.filter((transaction) => transaction.type === 'debit').length,
    creditAmount: monthFiltered.filter((transaction) => transaction.type === 'credit').reduce((sum, transaction) => sum + transaction.amount, 0),
    debitAmount: monthFiltered.filter((transaction) => transaction.type === 'debit').reduce((sum, transaction) => sum + transaction.amount, 0),
    pendingAmount: monthFiltered.filter((transaction) => transaction.status === 'pending').reduce((sum, transaction) => sum + transaction.amount, 0),
    unmatchedReceipts: receipts.filter((receipt) => !receipt.linkedTransactionId).length,
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
    scanProgress,
    selectedTransaction,
    setSelectedTransaction,
    importStatement,
    addReceipt,
    addReceiptWithAutoReconcile,
    linkReceiptToTransaction,
    unlinkReceipt,
    validateTransactionWithoutReceipt,
    addPersonalExpense,
    removeTransaction,
    removePersonalExpense,
    clearAll,
    importFromExcelData,
    stats,
  };
}
