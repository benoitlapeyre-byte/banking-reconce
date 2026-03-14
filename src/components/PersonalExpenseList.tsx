import { PersonalExpense } from '@/lib/types';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PersonalExpenseListProps {
  expenses: PersonalExpense[];
  onRemove: (id: string) => void;
}

export function PersonalExpenseList({ expenses, onRemove }: PersonalExpenseListProps) {
  if (expenses.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-1">
        Dépenses personnelles ({expenses.length})
      </p>
      <div className="space-y-1">
        {expenses.map(exp => (
          <div
            key={exp.id}
            className={cn(
              "flex items-center gap-3 px-3 py-2 border rounded-sm group transition-snappy hover:bg-secondary/50"
            )}
          >
            <div className="w-[3px] h-[28px] bg-personal rounded-full flex-shrink-0" />
            <span className="font-mono text-xs text-muted-foreground w-[80px] flex-shrink-0">{exp.date}</span>
            <span className="text-sm truncate flex-1">{exp.merchant}</span>
            <span className="font-mono text-sm tabular-nums flex-shrink-0">
              {exp.amount.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
            </span>
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase bg-personal-light text-personal">
              À rembourser
            </span>
            <button
              onClick={() => onRemove(exp.id)}
              className="p-1 opacity-0 group-hover:opacity-100 hover:bg-destructive/10 rounded-sm transition-snappy"
            >
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
