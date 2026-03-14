import { Transaction, Receipt } from '@/lib/types';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { Paperclip, X } from 'lucide-react';

interface TransactionTableProps {
  transactions: Transaction[];
  receipts: Receipt[];
  onSelect: (tx: Transaction) => void;
  selectedId?: string;
  onUnlink: (txId: string) => void;
  onRemove: (txId: string) => void;
}

const statusIndicator = {
  pending: 'bg-pending',
  matched: 'bg-match',
  personal: 'bg-personal',
};

const rowVariant = {
  initial: { opacity: 0, y: 5 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, x: -10 },
};

export function TransactionTable({ transactions, receipts, onSelect, selectedId, onUnlink, onRemove }: TransactionTableProps) {
  if (transactions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <p className="text-sm">Aucune transaction à afficher.</p>
        <p className="text-xs mt-1">Importez un relevé bancaire pour commencer.</p>
      </div>
    );
  }

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
            <th className="w-[3px] p-0" />
            <th className="py-2 px-3 w-[100px]">Date</th>
            <th className="py-2 px-3">Libellé</th>
            <th className="py-2 px-3 w-[120px] text-right">Montant</th>
            <th className="py-2 px-3 w-[100px]">État</th>
            <th className="py-2 px-3 w-[80px]" />
          </tr>
        </thead>
        <tbody>
          <AnimatePresence mode="popLayout">
            {transactions.map((tx, i) => {
              const receipt = receipts.find(r => r.id === tx.receiptId);
              return (
                <motion.tr
                  key={tx.id}
                  variants={rowVariant}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={{ duration: 0.15, delay: i * 0.02 }}
                  onClick={() => onSelect(tx)}
                  className={cn(
                    "border-b cursor-pointer transition-snappy group",
                    "hover:bg-secondary/50",
                    selectedId === tx.id && "bg-secondary",
                    i % 2 === 0 && "bg-background",
                    i % 2 === 1 && "bg-muted/30",
                    tx.status === 'matched' && "animate-match-flash"
                  )}
                >
                  <td className="p-0">
                    <div className={cn("w-[3px] h-full min-h-[36px]", statusIndicator[tx.status])} />
                  </td>
                  <td className="py-2 px-3 font-mono text-xs">{tx.date}</td>
                  <td className="py-2 px-3 truncate max-w-[300px]" title={tx.label}>{tx.label}</td>
                  <td className={cn(
                    "py-2 px-3 font-mono text-right tabular-nums",
                    tx.amount < 0 ? "text-foreground" : "text-primary"
                  )}>
                    {tx.amount.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
                  </td>
                  <td className="py-2 px-3">
                    <span className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                      tx.status === 'matched' && "bg-match-light text-primary",
                      tx.status === 'pending' && "bg-secondary text-muted-foreground",
                      tx.status === 'personal' && "bg-personal-light text-personal",
                    )}>
                      {tx.status === 'matched' ? 'Justifié' : tx.status === 'pending' ? 'En attente' : 'Personnel'}
                    </span>
                  </td>
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-snappy">
                      {receipt && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onUnlink(tx.id); }}
                          className="p-1 hover:bg-destructive/10 rounded-sm"
                          title="Délier le justificatif"
                        >
                          <Paperclip className="h-3.5 w-3.5 text-primary" />
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); onRemove(tx.id); }}
                        className="p-1 hover:bg-destructive/10 rounded-sm"
                        title="Supprimer"
                      >
                        <X className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    </div>
                  </td>
                </motion.tr>
              );
            })}
          </AnimatePresence>
        </tbody>
      </table>
    </div>
  );
}
