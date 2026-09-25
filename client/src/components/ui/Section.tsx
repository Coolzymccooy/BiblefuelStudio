import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

interface SectionProps {
    title: string;
    subtitle?: string;
    defaultOpen?: boolean;
    collapsible?: boolean;
    rightSlot?: ReactNode;
    children: ReactNode;
}

/**
 * Collapsible form section.
 *
 * Replaces ad-hoc accordions with all-caps tracked subtitles. Subtitle is
 * sentence-case, smaller, and only rendered when present - so short sections
 * (3 fields or less) should just pass `collapsible={false}` and skip the
 * subtitle entirely.
 */
export function Section({
    title,
    subtitle,
    defaultOpen = false,
    collapsible = true,
    rightSlot,
    children,
}: SectionProps) {
    const [open, setOpen] = useState(defaultOpen || !collapsible);

    if (!collapsible) {
        return (
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.015] overflow-hidden">
                <div className="px-4 py-3 flex items-center justify-between border-b border-white/[0.04]">
                    <div>
                        <div className="section-title">{title}</div>
                        {subtitle && <div className="section-subtitle">{subtitle}</div>}
                    </div>
                    {rightSlot}
                </div>
                <div className="px-4 py-4 space-y-4">{children}</div>
            </div>
        );
    }

    return (
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.015] overflow-hidden transition-colors hover:border-white/[0.10]">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.025] transition-colors text-left"
                aria-expanded={open}
            >
                <div className="flex-1 min-w-0">
                    <div className="section-title">{title}</div>
                    {subtitle && <div className="section-subtitle truncate">{subtitle}</div>}
                </div>
                <div className="flex items-center gap-3">
                    {rightSlot}
                    <ChevronDown
                        size={16}
                        className={`text-gray-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
                    />
                </div>
            </button>
            {open && (
                <div className="px-4 pb-4 pt-3 border-t border-white/[0.04] space-y-4">
                    {children}
                </div>
            )}
        </div>
    );
}
