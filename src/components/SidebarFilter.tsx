import { FilterStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

interface SidebarFilterProps {
  filter: FilterStatus;
  onFilterChange: (filter: FilterStatus) => void;
  stats: {
    total: number;
    pending: number;
    matched: number;
    personal: number;
  };
}

const filters: { key: FilterStatus; label: string }[] = [
  { key: 'all', label: 'Tout' },
  { key: 'pending', label: 'En attente' },
  { key: 'matched', label: 'Réconcilié' },
  { key: 'personal', label: 'Personnel' },
];

export function SidebarFilter({ filter, onFilterChange, stats }: SidebarFilterProps) {
  const getCount = (key: FilterStatus) => {
    switch (key) {
      case 'all': return stats.total;
      case 'pending': return stats.pending;
      case 'matched': return stats.matched;
      case 'personal': return stats.personal;
    }
  };

  return (
    <nav className="flex flex-col gap-0.5">
      <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Filtres
      </p>
      {filters.map(f => (
        <button
          key={f.key}
          onClick={() => onFilterChange(f.key)}
          className={cn(
            "flex items-center justify-between px-3 py-2 rounded-sm text-sm transition-snappy",
            filter === f.key
              ? "bg-accent text-accent-foreground font-medium"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground"
          )}
        >
          <span>{f.label}</span>
          <span className="font-mono text-xs">{getCount(f.key)}</span>
        </button>
      ))}
    </nav>
  );
}
