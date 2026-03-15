export type TransactionType = 'credit' | 'debit';
export type TransactionStatus = 'pending' | 'matched' | 'auto-matched' | 'personal';

export interface Transaction {
  id: string;
  date: string;
  label: string;
  amount: number;
  type: TransactionType;
  status: TransactionStatus;
  receiptId?: string;
  reconciliationNote?: string;
  raw: string;
}

export interface Receipt {
  id: string;
  name: string;
  file: File;
  thumbnailUrl: string;
  linkedTransactionId?: string;
  createdAt: string;
}

export interface PersonalExpense {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  receiptId?: string;
  note?: string;
  createdAt: string;
}

export type FilterStatus = 'all' | 'pending' | 'matched' | 'auto-matched' | 'credit' | 'debit';
