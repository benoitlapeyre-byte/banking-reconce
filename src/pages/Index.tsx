import { useState } from 'react';
import { useLedger } from '@/hooks/useLedger';
import { SidebarFilter } from '@/components/SidebarFilter';
import { Dropzone } from '@/components/Dropzone';
import { TransactionTable } from '@/components/TransactionTable';
import { DetailPanel } from '@/components/DetailPanel';
import { PersonalExpensePanel } from '@/components/PersonalExpensePanel';
import { PersonalExpenseList } from '@/components/PersonalExpenseList';
import { Upload, Plus, Trash2, AlertTriangle, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { toast } from 'sonner';

const Index = () => {
  const ledger = useLedger();
  const [showPersonalPanel, setShowPersonalPanel] = useState(false);

  const handleImportStatement = async (files: File[]) => {
    for (const file of files) {
      if (file.type !== 'application/pdf') {
        toast.error(`${file.name} n'est pas un fichier PDF.`);
        continue;
      }
      const count = await ledger.importStatement(file);
      if (count > 0) {
        toast.success(`${count} transactions importées depuis ${file.name}`);
      } else {
        toast.warning(`Aucune transaction trouvée dans ${file.name}. Vérifiez le format du relevé.`);
      }
    }
  };

  const handleImportReceipts = (files: File[]) => {
    for (const file of files) {
      ledger.addReceiptWithAutoReconcile(file);
    }
  };

  const isEmpty = ledger.allTransactions.length === 0 && ledger.personalExpenses.length === 0;

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-[280px] border-r flex flex-col flex-shrink-0">
        <div className="px-5 py-4 border-b">
          <h1 className="text-lg font-semibold tracking-tight">Ledge</h1>
          <p className="text-[10px] text-muted-foreground mt-0.5">Réconciliation locale</p>
        </div>

        <div className="px-2 py-3 flex-1">
          <SidebarFilter
            filter={ledger.filter}
            onFilterChange={ledger.setFilter}
            stats={ledger.stats}
          />

          {!isEmpty && (
            <div className="mt-6 px-3 space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Résumé</p>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">En attente</span>
                  <span className="font-mono font-medium">{ledger.stats.pending}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <ArrowDownLeft className="h-3 w-3 text-primary" /> Crédits
                  </span>
                  <span className="font-mono font-medium text-primary">
                    +{ledger.stats.creditAmount.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <ArrowUpRight className="h-3 w-3 text-destructive" /> Débits
                  </span>
                  <span className="font-mono font-medium text-destructive">
                    −{ledger.stats.debitAmount.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
                  </span>
                </div>
                <div className="flex justify-between border-t pt-1.5 mt-1.5">
                  <span className="text-muted-foreground">Justificatifs libres</span>
                  <span className="font-mono font-medium">{ledger.stats.unmatchedReceipts}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-3 py-3 border-t">
          <div className="flex gap-2 items-start text-[10px] text-muted-foreground">
            <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
            <span>Données stockées localement. Vider le cache efface les données.</span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="flex items-center justify-between px-5 py-3 border-b flex-shrink-0">
          <div>
            <p className="text-sm font-medium">
              {ledger.stats.pending > 0
                ? `${ledger.stats.pending} transaction${ledger.stats.pending > 1 ? 's' : ''} en attente de justificatif`
                : isEmpty ? 'Aucune donnée' : 'Toutes les transactions sont justifiées ✓'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowPersonalPanel(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 border rounded-sm text-xs font-medium hover:bg-secondary transition-snappy"
            >
              <Plus className="h-3.5 w-3.5" />
              Dépense personnelle
            </button>
            <label className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-accent-foreground rounded-sm text-xs font-medium cursor-pointer hover:opacity-90 transition-snappy">
              <Upload className="h-3.5 w-3.5" />
              Importer relevé
              <input
                type="file"
                accept=".pdf"
                className="hidden"
                multiple
                onChange={e => {
                  if (e.target.files) handleImportStatement(Array.from(e.target.files));
                  e.target.value = '';
                }}
              />
            </label>
            {!isEmpty && (
              <button
                onClick={() => {
                  if (confirm('Supprimer toutes les données ?')) ledger.clearAll();
                }}
                className="p-1.5 border rounded-sm hover:bg-destructive/10 transition-snappy"
                title="Tout effacer"
              >
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center h-full px-8 max-w-lg mx-auto gap-6">
              <div className="text-center">
                <h2 className="text-lg font-semibold mb-1">Réconciliation bancaire</h2>
                <p className="text-sm text-muted-foreground">
                  Importez un relevé puis ajoutez des justificatifs — le rapprochement se fait automatiquement par montant.
                </p>
              </div>
              <div className="w-full space-y-4">
                <Dropzone
                  onDrop={handleImportStatement}
                  accept=".pdf"
                  label="1. Importer un relevé bancaire"
                  sublabel="Glissez un PDF ou cliquez pour sélectionner"
                />
                <Dropzone
                  onDrop={handleImportReceipts}
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  label="2. Importer des justificatifs"
                  sublabel="Nommez vos fichiers avec le montant pour un rapprochement automatique (ex: facture_1170.pdf)"
                  compact
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4 pb-8">
              <div className="px-5 pt-4">
                <Dropzone
                  onDrop={handleImportReceipts}
                  accept=".pdf,.jpg,.jpeg,.png,.webp"
                  label="Ajouter des justificatifs (rapprochement auto par montant)"
                  sublabel="Nommez vos fichiers avec le montant pour un rapprochement automatique (ex: facture_1170.pdf)"
                  compact
                />
              </div>

              <div className="px-5">
                <TransactionTable
                  transactions={ledger.transactions}
                  receipts={ledger.receipts}
                  onSelect={ledger.setSelectedTransaction}
                  selectedId={ledger.selectedTransaction?.id}
                  onUnlink={ledger.unlinkReceipt}
                  onRemove={ledger.removeTransaction}
                />
              </div>

              {ledger.personalExpenses.length > 0 && (
                <div className="px-5">
                  <PersonalExpenseList
                    expenses={ledger.personalExpenses}
                    onRemove={ledger.removePersonalExpense}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {ledger.isProcessing && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-accent text-accent-foreground px-4 py-2 rounded-sm text-xs font-medium shadow-card">
            Analyse du relevé en cours...
          </div>
        )}
      </main>

      <DetailPanel
        transaction={ledger.selectedTransaction}
        receipts={ledger.receipts}
        onClose={() => ledger.setSelectedTransaction(null)}
        onAddReceipt={ledger.addReceipt}
        onLinkReceipt={ledger.linkReceiptToTransaction}
      />

      <PersonalExpensePanel
        open={showPersonalPanel}
        onClose={() => setShowPersonalPanel(false)}
        onAdd={ledger.addPersonalExpense}
        onAddReceipt={ledger.addReceipt}
      />
    </div>
  );
};

export default Index;
