import { Download, FileSpreadsheet, FileText, Upload } from 'lucide-react';
import { Transaction, PersonalExpense, Receipt } from '@/lib/types';
import { exportToExcel, exportToPDF, importFromExcel } from '@/lib/export';
import { toast } from 'sonner';

interface ExportBarProps {
  transactions: Transaction[];
  personalExpenses: PersonalExpense[];
  receipts: Receipt[];
  month: string | null;
  onImportExcel: (data: { transactions: Transaction[]; personalExpenses: PersonalExpense[] }) => void;
}

export function ExportBar({ transactions, personalExpenses, receipts, month, onImportExcel }: ExportBarProps) {
  const handleExcelExport = () => {
    exportToExcel({ transactions, personalExpenses, receipts, month: month || undefined });
    toast.success('Export Excel téléchargé');
  };

  const handlePDFExport = () => {
    exportToPDF({ transactions, personalExpenses, receipts, month: month || undefined });
    toast.success('Export PDF téléchargé');
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await importFromExcel(file);
      onImportExcel(data);
      toast.success(`Importé: ${data.transactions.length} transactions, ${data.personalExpenses.length} dépenses`);
    } catch {
      toast.error("Erreur lors de l'import Excel");
    }
    e.target.value = '';
  };

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={handleExcelExport}
        className="flex items-center gap-1 px-2.5 py-1.5 border rounded-sm text-xs font-medium hover:bg-secondary transition-snappy"
        title="Exporter en Excel"
      >
        <FileSpreadsheet className="h-3.5 w-3.5 text-primary" />
        Excel
      </button>
      <button
        onClick={handlePDFExport}
        className="flex items-center gap-1 px-2.5 py-1.5 border rounded-sm text-xs font-medium hover:bg-secondary transition-snappy"
        title="Exporter en PDF"
      >
        <FileText className="h-3.5 w-3.5 text-destructive" />
        PDF
      </button>
      <label className="flex items-center gap-1 px-2.5 py-1.5 border rounded-sm text-xs font-medium cursor-pointer hover:bg-secondary transition-snappy" title="Importer depuis Excel">
        <Upload className="h-3.5 w-3.5 text-muted-foreground" />
        Import
        <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} />
      </label>
    </div>
  );
}
