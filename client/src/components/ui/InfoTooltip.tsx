import { useState, useRef, useEffect, type ReactNode } from 'react';
import { Info } from 'lucide-react';

interface InfoTooltipProps {
    content: ReactNode;
    side?: 'top' | 'bottom';
    align?: 'start' | 'center' | 'end';
    iconClassName?: string;
    width?: 'sm' | 'md' | 'lg';
}

/**
 * Compact info icon that reveals helper text on hover, focus, or tap.
 *
 * Replaces the previous "wall of gray subtitle text under every label"
 * pattern. On desktop the popover follows hover/focus; on touch it toggles
 * on click and dismisses on outside-tap. Aim for one short sentence per
 * tooltip - if you need a paragraph, the content probably belongs as inline
 * `hint` text instead.
 */
export function InfoTooltip({
    content,
    side = 'top',
    align = 'start',
    iconClassName = '',
    width = 'md',
}: InfoTooltipProps) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        if (!open) return;
        function onDocClick(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        }
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') setOpen(false);
        }
        document.addEventListener('mousedown', onDocClick);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDocClick);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const widthClass = width === 'sm' ? 'min-w-[180px] max-w-[220px]' : width === 'lg' ? 'min-w-[260px] max-w-[340px]' : 'min-w-[220px] max-w-[280px]';
    const sideClass = side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2';
    const alignClass = align === 'start' ? 'left-0' : align === 'center' ? 'left-1/2 -translate-x-1/2' : 'right-0';

    return (
        <span ref={ref} className="relative inline-flex">
            <button
                type="button"
                aria-label="More info"
                aria-expanded={open}
                onMouseEnter={() => setOpen(true)}
                onMouseLeave={() => setOpen(false)}
                onFocus={() => setOpen(true)}
                onBlur={() => setOpen(false)}
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpen((v) => !v);
                }}
                className={`inline-flex items-center justify-center w-[14px] h-[14px] rounded-full text-gray-500 hover:text-gray-300 focus:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-500/40 transition-colors ${iconClassName}`}
            >
                <Info size={13} strokeWidth={2} />
            </button>
            {open && (
                <span
                    role="tooltip"
                    className={`
                        absolute z-50 ${widthClass} ${sideClass} ${alignClass}
                        px-3 py-2 rounded-lg
                        bg-dark-900/[0.98] backdrop-blur-xl border border-white/[0.10] shadow-2xl shadow-black/40
                        text-[0.8125rem] text-gray-200 leading-relaxed font-normal normal-case tracking-normal
                        animate-fade-in pointer-events-none
                    `}
                >
                    {content}
                </span>
            )}
        </span>
    );
}
