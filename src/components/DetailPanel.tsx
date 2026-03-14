import { Transaction, Receipt } from '@/lib/types';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Link, FileText, Image as ImageIcon } from 'lucide-react';
import { Dropzone } from './Dropzone';

interface DetailPanelProps {
  transaction: Transaction | null;
  receipts: Receipt[];
  onClose: () => void;
  onAddReceipt: (file: File) => Receipt;
  onLinkReceipt: (receiptId: string, transactionId: string) => void;
}

export function DetailPanel({ transaction, receipts, onClose, onAddReceipt, onLinkReceipt }: DetailPanelProps) {
  const linkedReceipt = receipts.find(r => r.id === transaction?.receiptId);
  const unlinkedReceipts = receipts.filter(r => !r.linkedTransactionId);

  const handleUploadAndLink = (files: File[]) => {
    if (!transaction) return;
    const file = files[0];
    if (file) {
      const receipt = onAddReceipt(file);
      onLinkReceipt(receipt.id, transaction.id);
    }
  };

  return (
    <AnimatePresence>
      {transaction && (
        <motion.div
          initial={{ x: '100%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="fixed right-0 top-0 h-full w-[400px] border-l bg-background shadow-card z-50 flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b">
            <h2 className="text-sm font-semibold">Détail de la transaction</h2>
            <button onClick={onClose} className="p-1 hover:bg-secondary rounded-sm transition-snappy">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {/* Transaction info */}
            <div className="space-y-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Date</p>
                <p className="font-mono text-sm">{transaction.date}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Libellé</p>
                <p className="text-sm">{transaction.label}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Montant</p>
                <p className="font-mono text-lg font-semibold">
                  {transaction.amount.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Ligne brute</p>
                <p className="text-xs text-muted-foreground font-mono bg-secondary px-2 py-1.5 rounded-sm break-all">
                  {transaction.raw}
                </p>
              </div>
            </div>

            {/* Linked receipt */}
            {linkedReceipt && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Justificatif lié</p>
                <div className="border rounded-sm overflow-hidden">
                  {linkedReceipt.thumbnailUrl && linkedReceipt.file.type.startsWith('image/') ? (
                    <img src={linkedReceipt.thumbnailUrl} alt={linkedReceipt.name} className="w-full max-h-[200px] object-contain bg-secondary" />
                  ) : (
                    <div className="flex items-center gap-2 p-3 bg-secondary">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xs truncate">{linkedReceipt.name}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Upload or link */}
            {!linkedReceipt && (
              <div className="space-y-3">
                <Dropzone
                  onDrop={handleUploadAndLink}
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  label="Ajouter un justificatif"
                  sublabel="PDF, JPG, PNG"
                  compact
                />

                {unlinkedReceipts.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                      Justificatifs disponibles ({unlinkedReceipts.length})
                    </p>
                    <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                      {unlinkedReceipts.map(r => (
                        <button
                          key={r.id}
                          onClick={() => onLinkReceipt(r.id, transaction.id)}
                          className="w-full flex items-center gap-2 px-3 py-2 border rounded-sm hover:bg-secondary transition-snappy text-left"
                        >
                          {r.file.type.startsWith('image/') ? (
                            <ImageIcon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                          ) : (
                            <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                          )}
                          <span className="text-xs truncate flex-1">{r.name}</span>
                          <Link className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
