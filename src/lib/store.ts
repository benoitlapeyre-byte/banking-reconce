import { Transaction, Receipt, PersonalExpense } from './types';

const KEYS = {
  transactions: 'ledge_transactions',
  receipts: 'ledge_receipts',
  personalExpenses: 'ledge_personal_expenses',
};

export function loadTransactions(): Transaction[] {
  try {
    const data = localStorage.getItem(KEYS.transactions);
    return data ? JSON.parse(data) : [];
  } catch { return []; }
}

export function saveTransactions(txs: Transaction[]) {
  localStorage.setItem(KEYS.transactions, JSON.stringify(txs));
}

export function loadReceipts(): Omit<Receipt, 'file'>[] {
  try {
    const data = localStorage.getItem(KEYS.receipts);
    return data ? JSON.parse(data) : [];
  } catch { return []; }
}

export function saveReceipts(receipts: Omit<Receipt, 'file' | 'thumbnailUrl'>[]) {
  localStorage.setItem(KEYS.receipts, JSON.stringify(receipts));
}

export function loadPersonalExpenses(): PersonalExpense[] {
  try {
    const data = localStorage.getItem(KEYS.personalExpenses);
    return data ? JSON.parse(data) : [];
  } catch { return []; }
}

export function savePersonalExpenses(expenses: PersonalExpense[]) {
  localStorage.setItem(KEYS.personalExpenses, JSON.stringify(expenses));
}

export function generateId(): string {
  return crypto.randomUUID();
}
