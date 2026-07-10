import { useState, type ReactNode } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';

interface RevealSectionProps {
  title: string;
  storageKey: string;
  defaultOpen?: boolean;
  icon?: LucideIcon;
  hint?: string;
  children: ReactNode;
}

function readOpen(storageKey: string, defaultOpen: boolean): boolean {
    try {
        const v = localStorage.getItem('bf.reveal.' + storageKey);
        if (v === '1') return true;
        if (v === '0') return false;
    } catch { /* ignore */ }
    return defaultOpen;
}

export function RevealSection({ title, storageKey, defaultOpen = false, icon: Icon, hint, children }: RevealSectionProps) {
    const [open, setOpen] = useState(() => readOpen(storageKey, defaultOpen));

    const toggle = () => {
        setOpen((prev) => {
            const next = !prev;
            try { localStorage.setItem('bf.reveal.' + storageKey, next ? '1' : '0'); } catch { /* ignore */ }
            return next;
        });
    };

    return (
        <section className="rounded-bf border border-[rgba(216,184,120,0.12)] bg-bf-card">
            <button
                type="button"
                onClick={toggle}
                aria-expanded={open}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
            >
                {Icon && <Icon size={18} className="shrink-0 text-bf-gold" />}
                <span className="flex-1 font-semibold text-[14px] text-bf-cream">{title}</span>
                {hint && <span className="text-help">{hint}</span>}
                <ChevronDown size={18} className={`shrink-0 text-bf-faint transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && <div className="px-4 pb-4 pt-1">{children}</div>}
        </section>
    );
}
