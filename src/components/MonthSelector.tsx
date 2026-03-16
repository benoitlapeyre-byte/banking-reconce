import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MonthSelectorProps {
  months: string[]; // ['2026-01', '2026-02', ...]
  selected: string | null; // null = all
  onSelect: (month: string | null) => void;
}

const MONTH_NAMES = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

function formatMonth(m: string): string {
  const [y, mo] = m.split('-');
  return `${MONTH_NAMES[parseInt(mo, 10) - 1]} ${y}`;
}

export function MonthSelector({ months, selected, onSelect }: MonthSelectorProps) {
  if (months.length === 0) return null;

  const currentIdx = selected ? months.indexOf(selected) : -1;

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onSelect(null)}
        className={cn(
          "px-2.5 py-1 rounded-sm text-xs font-medium transition-snappy",
          !selected ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-secondary"
        )}
      >
        Tout
      </button>

      {months.length > 1 && selected && (
        <button
          onClick={() => {
            const prev = currentIdx > 0 ? months[currentIdx - 1] : null;
            if (prev) onSelect(prev);
          }}
          disabled={currentIdx <= 0}
          className="p-1 rounded-sm hover:bg-secondary disabled:opacity-30 transition-snappy"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      )}

      {months.map(m => (
        <button
          key={m}
          onClick={() => onSelect(m)}
          className={cn(
            "px-2.5 py-1 rounded-sm text-xs font-medium transition-snappy",
            selected === m ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-secondary"
          )}
        >
          {formatMonth(m)}
        </button>
      ))}

      {months.length > 1 && selected && (
        <button
          onClick={() => {
            const next = currentIdx < months.length - 1 ? months[currentIdx + 1] : null;
            if (next) onSelect(next);
          }}
          disabled={currentIdx >= months.length - 1}
          className="p-1 rounded-sm hover:bg-secondary disabled:opacity-30 transition-snappy"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
