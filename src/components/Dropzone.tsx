import { useCallback, useState } from 'react';
import { Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DropzoneProps {
  onDrop: (files: File[]) => void;
  accept: string;
  label: string;
  sublabel?: string;
  compact?: boolean;
}

export function Dropzone({ onDrop, accept, label, sublabel, compact }: DropzoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragOver(false), []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) onDrop(files);
  }, [onDrop]);

  const handleClick = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = true;
    input.onchange = () => {
      if (input.files) onDrop(Array.from(input.files));
    };
    input.click();
  }, [accept, onDrop]);

  return (
    <button
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "w-full border-2 border-dashed rounded-sm transition-snappy cursor-pointer text-center",
        "border-border hover:border-muted-foreground",
        isDragOver && "border-primary bg-match-light",
        compact ? "px-4 py-6" : "px-8 py-16"
      )}
    >
      <Upload className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">{label}</p>
      {sublabel && <p className="mt-1 text-xs text-muted-foreground">{sublabel}</p>}
    </button>
  );
}
