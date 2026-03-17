import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ScanLine, CheckCircle2 } from 'lucide-react';
import { Dropzone } from './Dropzone';
import { PersonalExpense } from '@/lib/types';
import { scanReceipt, ScanProgress } from '@/lib/receipt-scanner';

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
  const [receiptName, setReceiptName] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [detectedAmounts, setDetectedAmounts] = useState<number[]>([]);
  const [scanned, setScanned] = useState(false);
  const [ocrDate, setOcrDate] = useState<string | null>(null);
  const [ocrMerchant, setOcrMerchant] = useState<string | null>(null);

  const reset = () => {
    setDate('');
    setMerchant('');
    setAmount('');
    setNote('');
    setReceiptId(undefined);
    setReceiptName('');
    setScanning(false);
    setScanProgress(null);
    setDetectedAmounts([]);
    setScanned(false);
    setOcrDate(null);
    setOcrMerchant(null);
  };

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
    reset();
    onClose();
  };

  const handleReceiptUpload = async (files: File[]) => {
    const file = files[0];
    if (!file) return;

    const receipt = onAddReceipt(file);
    setReceiptId(receipt.id);
    setReceiptName(file.name);
    setScanning(true);
    setScanned(false);
    setDetectedAmounts([]);

    try {
      const result = await scanReceipt(file, (p) => setScanProgress(p));
      setScanProgress(null);
      setDetectedAmounts(result.amounts);
      setScanned(true);

      // Auto-fill amount (largest = likely TTC total)
      if (result.amounts.length > 0) {
        setAmount(result.amounts[0].toFixed(2).replace('.', ','));
      }

      // Auto-fill date from OCR, fallback to today
      if (result.date) {
        setDate(result.date);
        setOcrDate(result.date);
      } else if (!date) {
        setDate(new Date().toISOString().slice(0, 10));
      }

      // Auto-fill merchant from OCR, fallback to filename
      if (result.merchant) {
        setMerchant(result.merchant);
        setOcrMerchant(result.merchant);
      } else if (!merchant) {
        const name = file.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ').trim();
        setMerchant(name);
      }
    } catch (e) {
      console.error('[PersonalExpense] OCR scan failed:', e);
      setScanProgress(null);
      setScanned(true);
    } finally {
      setScanning(false);
    }
  };

  const selectAmount = (val: number) => {
    setAmount(val.toFixed(2).replace('.', ','));
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
            <button onClick={() => { reset(); onClose(); }} className="p-1 hover:bg-secondary rounded-sm transition-snappy">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* Step 1: Upload receipt for OCR */}
            {!scanned && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  <ScanLine className="inline h-3.5 w-3.5 mr-1" />
                  Importez le justificatif — le montant TTC, la date et le marchand seront détectés automatiquement.
                </p>
                <Dropzone
                  onDrop={handleReceiptUpload}
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  label={scanning ? "Scan OCR en cours…" : "Importer un justificatif"}
                  sublabel="PDF, JPG, PNG — extraction automatique par OCR"
                  compact
                />
                {scanProgress && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span className="truncate max-w-[180px]">{scanProgress.fileName}</span>
                      <span>
                        {scanProgress.status === 'extracting' && 'Extraction…'}
                        {scanProgress.status === 'recognizing' && 'OCR…'}
                        {scanProgress.status === 'parsing' && 'Analyse…'}
                        {scanProgress.status === 'done' && '✓'}
                      </span>
                    </div>
                    <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-300"
                        style={{ width: `${scanProgress.progress}%` }}
                      />
                    </div>
                  </div>
                )}
                {!scanning && !scanned && (
                  <button
                    type="button"
                    onClick={() => setScanned(true)}
                    className="text-[10px] text-muted-foreground hover:text-foreground underline transition-snappy"
                  >
                    Saisir manuellement sans justificatif
                  </button>
                )}
              </div>
            )}

            {/* Step 2: Auto-filled form — user corrects only if needed */}
            {scanned && (
              <form onSubmit={handleSubmit} className="space-y-4">
                {receiptName && (
                  <div className="flex items-center gap-2 text-xs text-primary bg-match-light px-3 py-2 rounded-sm">
                    <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="truncate">{receiptName}</span>
                  </div>
                )}

                {/* OCR detection summary */}
                {(detectedAmounts.length > 0 || ocrDate || ocrMerchant) && (
                  <div className="bg-secondary/50 border rounded-sm px-3 py-2 space-y-1">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Détecté par OCR
                    </p>
                    {ocrDate && (
                      <p className="text-xs text-foreground">📅 Date : {new Date(ocrDate).toLocaleDateString('fr-FR')}</p>
                    )}
                    {ocrMerchant && (
                      <p className="text-xs text-foreground truncate">🏪 Marchand : {ocrMerchant}</p>
                    )}
                    {detectedAmounts.length > 0 && (
                      <p className="text-xs text-foreground">
                        💰 Montant : {detectedAmounts[0].toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
                        {detectedAmounts.length > 1 && ` (+${detectedAmounts.length - 1} autres)`}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground italic mt-1">
                      Corrigez ci-dessous si nécessaire
                    </p>
                  </div>
                )}

                {detectedAmounts.length > 1 && (
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5 block">
                      Autres montants détectés
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {detectedAmounts.map((a, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => selectAmount(a)}
                          className={`px-2.5 py-1 rounded-sm text-xs font-mono border transition-snappy ${
                            amount === a.toFixed(2).replace('.', ',')
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'hover:bg-secondary border-border'
                          }`}
                        >
                          {a.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1 block">
                    Date {ocrDate && <span className="text-primary normal-case">— détectée par OCR</span>}
                  </label>
                  <input
                    type="date"
                    value={date}
                    onChange={e => setDate(e.target.value)}
                    required
                    className="w-full border rounded-sm px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1 block">
                    Marchand {ocrMerchant && <span className="text-primary normal-case">— détecté par OCR</span>}
                  </label>
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
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1 block">
                    Montant (€) {detectedAmounts.length > 0 && <span className="text-primary normal-case">— détecté par OCR</span>}
                  </label>
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

                <button
                  type="submit"
                  className="w-full bg-accent text-accent-foreground py-2.5 px-4 rounded-sm text-sm font-medium hover:opacity-90 transition-snappy"
                >
                  Ajouter la dépense
                </button>
              </form>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
