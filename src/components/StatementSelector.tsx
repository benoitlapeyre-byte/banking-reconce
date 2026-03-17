import { FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatementSelectorProps {
  sources: string[];
  selected: string | null;
  onSelect: (source: string | null) => void;
}

export function StatementSelector({ sources, selected, onSelect }: StatementSelectorProps) {
  if (sources.length <= 1) return null;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
      <button
        onClick={() => onSelect(null)}
        className={cn(
          "px-2.5 py-1 rounded-sm text-xs font-medium transition-snappy",
          !selected ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-secondary"
        )}
      >
        Tous les relevés
      </button>
      {sources.map((src) => (
        <button
          key={src}
          onClick={() => onSelect(src)}
          className={cn(
            "px-2.5 py-1 rounded-sm text-xs font-medium transition-snappy truncate max-w-[200px]",
            selected === src ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-secondary"
          )}
          title={src}
        >
          {src.replace(/\.pdf$/i, '')}
        </button>
      ))}
    </div>
  );
}
