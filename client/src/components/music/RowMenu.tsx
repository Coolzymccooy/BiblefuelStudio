import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { MoreHorizontal } from 'lucide-react';

export interface RowMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/**
 * The "⋯" on a track row. Opening moves focus to the first item; the arrow
 * keys move between items (wrapping), and Escape or a choice closes it. A
 * click elsewhere closes it too, so a narrow panel never keeps a stray menu.
 */
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    const onDown = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
    if (e.key === 'Tab') { close(false); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const list = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
    if (list.length === 0) return;
    const at = list.indexOf(document.activeElement as HTMLElement);
    const to = e.key === 'Home' ? 0
      : e.key === 'End' ? list.length - 1
        : (at + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
    list[to].focus();
  };

  if (items.length === 0) return null;
  return (
    <div ref={boxRef} className="relative shrink-0">
      <button
        ref={triggerRef}
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
        <div
          ref={menuRef}
          role="menu"
          aria-label={`Actions for ${label}`}
          onKeyDown={onMenuKey}
          className="absolute right-0 z-30 mt-1 min-w-[180px] overflow-hidden rounded-lg border border-[rgba(216,184,120,0.25)] bg-bf-card py-1 text-xs shadow-xl"
        >
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={it.disabled}
              onClick={() => { close(true); it.onSelect(); }}
              className={`block w-full px-3 py-1.5 text-left transition hover:bg-bf-card2 focus:bg-bf-card2 focus:outline-none disabled:cursor-not-allowed disabled:text-bf-muted ${it.danger ? 'text-bf-danger' : 'text-bf-cream'}`}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
