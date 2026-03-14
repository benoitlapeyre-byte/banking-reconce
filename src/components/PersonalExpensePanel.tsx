import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { Dropzone } from './Dropzone';
import { PersonalExpense } from '@/lib/types';

interface PersonalExpensePanelProps {
  open: boolean;
  onClose: () => void;
  onAdd: (expense: Omit<PersonalExpense, 'id' | 'createdAt'>) => void;
  onAddReceipt: (file: File) => { id: string };
}

export function PersonalExpensePanel({ open, onClose, onAdd, onAddReceipt }: PersonalExpensePanelProps) {
  const [date, setDate] = useState('');
  const [merchant, setMerchant] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [receiptId, setReceiptId] = useState<string>();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !merchant || !amount) return;
    onAdd({
      date,
      merchant,
      amount: parseFloat(amount.replace(',', '.')),
      note: note || undefined,
      receiptId,
    });
    setDate('');
    setMerchant('');
    setAmount('');
    setNote('');
    setReceiptId(undefined);
    onClose();
  };

  const handleReceiptUpload = (files: File[]) => {
    if (files[0]) {
      const receipt = onAddReceipt(files[0]);
      setReceiptId(receipt.id);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ x: '100%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="fixed right-0 top-0 h-full w-[400px] border-l bg-background shadow-card z-50 flex flex-col"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b">
            <h2 className="text-sm font-semibold">Dépense personnelle</h2>
            <button onClick={onClose} className="p-1 hover:bg-secondary rounded-sm transition-snappy">
              <X className="h-4 w-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1 block">Date</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                required
                className="w-full border rounded-sm px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1 block">Marchand</label>
              <input
                type="text"
                value={merchant}
                onChange={e => setMerchant(e.target.value)}
                required
                placeholder="Ex: Restaurant Le Comptoir"
                className="w-full border rounded-sm px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1 block">Montant (€)</label>
              <input
                type="text"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                required
                placeholder="42,50"
                className="w-full border rounded-sm px-3 py-2 text-sm font-mono bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1 block">Note (optionnel)</label>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={2}
                placeholder="Déjeuner client..."
                className="w-full border rounded-sm px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
            </div>

            <Dropzone
              onDrop={handleReceiptUpload}
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              label={receiptId ? "Justificatif ajouté ✓" : "Ajouter un justificatif"}
              sublabel="PDF, JPG, PNG"
              compact
            />

            <button
              type="submit"
              className="w-full bg-accent text-accent-foreground py-2.5 px-4 rounded-sm text-sm font-medium hover:opacity-90 transition-snappy"
            >
              Ajouter la dépense
            </button>
          </form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
