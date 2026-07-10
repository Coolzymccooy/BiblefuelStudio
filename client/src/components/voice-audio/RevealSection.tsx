import { useState, type ReactNode } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';
import { InfoTooltip } from '../ui/InfoTooltip';

interface RevealSectionProps {
    title: string;
    storageKey: string;
    defaultOpen?: boolean;
    icon?: LucideIcon;
    hint?: string;
    /**
     * Optional helper copy surfaced as an ⓘ tooltip beside the title. Use it to
     * lift descriptive "what is this / how to use" text out of the section body
     * so the panel reads cleanly. Rendered as a SIBLING of the toggle button —
     * never nested inside it (a <button> inside a <button> is invalid HTML and
     * triggers a React hydration warning).
     */
    info?: ReactNode;
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

export function RevealSection({ title, storageKey, defaultOpen = false, icon: Icon, hint, info, children }: RevealSectionProps) {
    const [open, setOpen] = useState(() => readOpen(storageKey, defaultOpen));

    const toggle = () => {
        setOpen((prev) => {
            const next = !prev;
            try { localStorage.setItem('bf.reveal.' + storageKey, next ? '1' : '0'); } catch { /* ignore */ }
            return next;
        });
    };

    return (
        <section className="glass rounded-bf">
            <div className="flex w-full items-center">
                <button
                    type="button"
                    onClick={toggle}
                    aria-expanded={open}
                    className="flex flex-1 min-w-0 items-center gap-3 px-4 py-3.5 text-left"
                >
                    {Icon && <Icon size={18} className="shrink-0 text-bf-gold" />}
                    <span className="flex-1 min-w-0 truncate font-semibold text-[14px] text-bf-cream">{title}</span>
                    {hint && <span className="text-help shrink-0">{hint}</span>}
                    <ChevronDown size={18} className={`shrink-0 text-bf-faint transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>
                {info && (
                    <span className="shrink-0 flex items-center pr-4 pl-1">
                        <InfoTooltip content={info} />
                    </span>
                )}
            </div>
            {open && <div className="px-4 pb-4 pt-1">{children}</div>}
        </section>
    );
}
