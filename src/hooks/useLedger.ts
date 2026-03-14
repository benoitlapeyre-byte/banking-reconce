import { useState, useCallback, useEffect } from 'react';
import { Transaction, Receipt, PersonalExpense, FilterStatus } from '@/lib/types';
import { loadTransactions, saveTransactions, loadPersonalExpenses, savePersonalExpenses, generateId } from '@/lib/store';
import { extractTextFromPDF, parseTransactions } from '@/lib/pdf-parser';

export function useLedger() {
  const [transactions, setTransactions] = useState<Transaction[]>(() => loadTransactions());
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [personalExpenses, setPersonalExpenses] = useState<PersonalExpense[]>(() => loadPersonalExpenses());
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);

  useEffect(() => { saveTransactions(transactions); }, [transactions]);
  useEffect(() => { savePersonalExpenses(personalExpenses); }, [personalExpenses]);

  const importStatement = useCallback(async (file: File) => {
    setIsProcessing(true);
    try {
      const text = await extractTextFromPDF(file);
      const parsed = parseTransactions(text);
      const newTxs: Transaction[] = parsed.map(t => ({
        id: generateId(),
        date: t.date,
        label: t.label,
        amount: t.amount,
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

  const linkReceiptToTransaction = useCallback((receiptId: string, transactionId: string) => {
    setReceipts(prev => prev.map(r =>
      r.id === receiptId ? { ...r, linkedTransactionId: transactionId } : r
    ));
    setTransactions(prev => prev.map(t =>
      t.id === transactionId ? { ...t, status: 'matched' as const, receiptId } : t
    ));
  }, []);

  const unlinkReceipt = useCallback((transactionId: string) => {
    setTransactions(prev => prev.map(t =>
      t.id === transactionId ? { ...t, status: 'pending' as const, receiptId: undefined } : t
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

  const filteredTransactions = transactions.filter(t => {
    if (filter === 'all') return true;
    return t.status === filter;
  });

  const stats = {
    total: transactions.length,
    pending: transactions.filter(t => t.status === 'pending').length,
    matched: transactions.filter(t => t.status === 'matched').length,
    personal: personalExpenses.length,
    pendingAmount: transactions.filter(t => t.status === 'pending').reduce((s, t) => s + Math.abs(t.amount), 0),
    unmatchedReceipts: receipts.filter(r => !r.linkedTransactionId).length,
  };

  return {
    transactions: filteredTransactions,
    allTransactions: transactions,
    receipts,
    personalExpenses,
    filter,
    setFilter,
    isProcessing,
    selectedTransaction,
    setSelectedTransaction,
    importStatement,
    addReceipt,
    linkReceiptToTransaction,
    unlinkReceipt,
    addPersonalExpense,
    removeTransaction,
    removePersonalExpense,
    clearAll,
    stats,
  };
}
