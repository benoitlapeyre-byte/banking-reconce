export type TransactionStatus = 'pending' | 'matched' | 'personal';

export interface Transaction {
  id: string;
  date: string;
  label: string;
  amount: number;
  status: TransactionStatus;
  receiptId?: string;
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

export type FilterStatus = 'all' | 'pending' | 'matched' | 'personal';
