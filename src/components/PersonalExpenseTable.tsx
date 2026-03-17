import { useState } from 'react';
import { PersonalExpense, Transaction, Receipt } from '@/lib/types';
import { X, Pencil, Check, Link2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PersonalExpenseTableProps {
  expenses: PersonalExpense[];
  transactions: Transaction[];
  receipts: Receipt[];
  onRemove: (id: string) => void;
  onUpdate: (id: string, updates: Partial<Pick<PersonalExpense, 'date' | 'merchant' | 'amount' | 'note'>>) => void;
  onReconcileWithTransaction: (expenseId: string, transactionId: string) => void;
}

export function PersonalExpenseTable({
  expenses,
  transactions,
  receipts,
  onRemove,
  onUpdate,
  onReconcileWithTransaction,
}: PersonalExpenseTableProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{ date: string; merchant: string; amount: string; note: string }>({
    date: '', merchant: '', amount: '', note: '',
  });
  const [linkingId, setLinkingId] = useState<string | null>(null);

  if (expenses.length === 0) return null;

  const pendingTransactions = transactions.filter(
    (tx) => tx.status === 'pending'
  );

  const startEdit = (exp: PersonalExpense) => {
    setEditingId(exp.id);
    setEditValues({
      date: exp.date,
      merchant: exp.merchant,
      amount: exp.amount.toFixed(2).replace('.', ','),
      note: exp.note || '',
    });
  };

  const saveEdit = (id: string) => {
    const parsed = parseFloat(editValues.amount.replace(',', '.'));
    if (!editValues.date || !editValues.merchant || isNaN(parsed)) return;
    onUpdate(id, {
      date: editValues.date,
      merchant: editValues.merchant,
      amount: parsed,
      note: editValues.note || undefined,
    });
    setEditingId(null);
  };

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-1">
        Dépenses personnelles ({expenses.length})
      </p>
      <div className="w-full overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
              <th className="w-[3px] p-0" />
              <th className="py-2 px-3 w-[110px]">Date</th>
              <th className="py-2 px-3">Marchand</th>
              <th className="py-2 px-3 w-[120px] text-right">Montant</th>
              <th className="py-2 px-3 w-[180px]">Justificatif</th>
              <th className="py-2 px-3 w-[150px]">Note</th>
              <th className="py-2 px-3 w-[130px]">État</th>
              <th className="py-2 px-3 w-[100px]" />
            </tr>
          </thead>
          <tbody>
            {expenses.map((exp, i) => {
              const isEditing = editingId === exp.id;
              const isLinking = linkingId === exp.id;
              const receipt = receipts.find((r) => r.id === exp.receiptId);

              return (
                <>
                  <tr
                    key={exp.id}
                    className={cn(
                      'border-b group transition-snappy hover:bg-secondary/50',
                      i % 2 === 0 && 'bg-background',
                      i % 2 === 1 && 'bg-muted/30',
                    )}
                  >
                    <td className="p-0">
                      <div className="w-[3px] h-full min-h-[36px] bg-personal" />
                    </td>
                    <td className="py-2 px-3">
                      {isEditing ? (
                        <input
                          type="date"
                          value={editValues.date}
                          onChange={(e) => setEditValues({ ...editValues, date: e.target.value })}
                          className="w-full border rounded-sm px-1.5 py-1 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                      ) : (
                        <span className="font-mono text-xs">{exp.date}</span>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editValues.merchant}
                          onChange={(e) => setEditValues({ ...editValues, merchant: e.target.value })}
                          className="w-full border rounded-sm px-1.5 py-1 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                      ) : (
                        <span className="text-sm truncate">{exp.merchant}</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editValues.amount}
                          onChange={(e) => setEditValues({ ...editValues, amount: e.target.value })}
                          className="w-full border rounded-sm px-1.5 py-1 text-xs font-mono text-right bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                      ) : (
                        <span className="font-mono text-sm tabular-nums">
                          {exp.amount.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      <span className="text-xs text-muted-foreground truncate max-w-[170px] block" title={receipt?.name}>
                        {receipt?.name || '—'}
                      </span>
                    </td>
                    <td className="py-2 px-3">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editValues.note}
                          onChange={(e) => setEditValues({ ...editValues, note: e.target.value })}
                          placeholder="Note..."
                          className="w-full border rounded-sm px-1.5 py-1 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground truncate max-w-[140px] block">
                          {exp.note || '—'}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3">
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase bg-personal-light text-personal">
                        À rembourser
                      </span>
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-snappy">
                        {isEditing ? (
                          <button
                            onClick={() => saveEdit(exp.id)}
                            className="p-1 hover:bg-primary/10 rounded-sm"
                            title="Enregistrer"
                          >
                            <Check className="h-3.5 w-3.5 text-primary" />
                          </button>
                        ) : (
                          <button
                            onClick={() => startEdit(exp)}
                            className="p-1 hover:bg-secondary rounded-sm"
                            title="Modifier"
                          >
                            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                        )}
                        {pendingTransactions.length > 0 && !isEditing && (
                          <button
                            onClick={() => setLinkingId(isLinking ? null : exp.id)}
                            className={cn(
                              "p-1 rounded-sm",
                              isLinking ? "bg-primary/10" : "hover:bg-secondary"
                            )}
                            title="Réconcilier avec une opération"
                          >
                            <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                        )}
                        <button
                          onClick={() => onRemove(exp.id)}
                          className="p-1 hover:bg-destructive/10 rounded-sm"
                          title="Supprimer"
                        >
                          <X className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {isLinking && (
                    <tr key={`${exp.id}-link`} className="border-b bg-secondary/30">
                      <td colSpan={7} className="px-6 py-3">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                          Réconcilier avec une opération bancaire ({pendingTransactions.length} en attente)
                        </p>
                        <div className="space-y-1 max-h-[200px] overflow-y-auto">
                          {pendingTransactions.map((tx) => (
                            <button
                              key={tx.id}
                              onClick={() => {
                                onReconcileWithTransaction(exp.id, tx.id);
                                setLinkingId(null);
                              }}
                              className="w-full flex items-center gap-3 px-3 py-2 border rounded-sm hover:bg-secondary transition-snappy text-left bg-background"
                            >
                              <span className="font-mono text-xs text-muted-foreground w-[80px] flex-shrink-0">{tx.date}</span>
                              <span className="text-xs truncate flex-1">{tx.label}</span>
                              <span className={cn(
                                "font-mono text-xs tabular-nums flex-shrink-0",
                                tx.type === 'credit' ? 'text-primary' : 'text-destructive'
                              )}>
                                {tx.type === 'debit' ? '−' : '+'}{' '}
                                {tx.amount.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
                              </span>
                              <Link2 className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
