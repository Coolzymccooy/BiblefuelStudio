import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

export interface RowMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/**
 * The "⋯" on a track row. Closes on a choice, a click elsewhere, or Escape,
 * so a narrow panel never keeps a stray menu open.
 */
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (items.length === 0) return null;
  return (
    <div ref={boxRef} className="relative shrink-0">
      <button
        type="button"
        aria-label={`More for ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="rounded p-1 text-bf-muted transition hover:bg-bf-card2 hover:text-bf-cream"
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div role="menu" aria-label={`Actions for ${label}`} className="absolute right-0 z-30 mt-1 min-w-[180px] overflow-hidden rounded-lg border border-[rgba(216,184,120,0.25)] bg-bf-card py-1 text-xs shadow-xl">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              onClick={() => { setOpen(false); it.onSelect(); }}
              className={`block w-full px-3 py-1.5 text-left transition hover:bg-bf-card2 disabled:opacity-40 ${it.danger ? 'text-bf-danger' : 'text-bf-cream'}`}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
