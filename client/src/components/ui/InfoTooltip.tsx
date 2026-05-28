import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

interface InfoTooltipProps {
    content: ReactNode;
    side?: 'top' | 'bottom';
    iconClassName?: string;
    width?: 'sm' | 'md' | 'lg';
}

const WIDTH_PX: Record<NonNullable<InfoTooltipProps['width']>, number> = {
    sm: 220,
    md: 280,
    lg: 340,
};

/**
 * Compact info icon that reveals helper text on hover, focus, or tap.
 *
 * The popover is rendered via a portal to document.body so it can't be
 * clipped by ancestor overflow-hidden (the .card class uses overflow-hidden
 * to crop the glow effect, which previously hid the top half of tooltips).
 * Position is computed with getBoundingClientRect on each open + viewport
 * scroll/resize, so it follows the trigger as the page moves.
 */
export function InfoTooltip({
    content,
    side = 'top',
    iconClassName = '',
    width = 'md',
}: InfoTooltipProps) {
    const [open, setOpen] = useState(false);
    const [coords, setCoords] = useState<{ top: number; left: number; placed: 'top' | 'bottom' }>({
        top: 0,
        left: 0,
        placed: side,
    });
    const triggerRef = useRef<HTMLButtonElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);

    const updateCoords = useCallback(() => {
        const trigger = triggerRef.current;
        if (!trigger) return;
        const r = trigger.getBoundingClientRect();
        const tooltipWidth = WIDTH_PX[width];
        const tooltipHeight = tooltipRef.current?.offsetHeight ?? 96;
        const margin = 8;
        const viewportPad = 8;

        let placed: 'top' | 'bottom' = side;
        let top: number;
        if (placed === 'top') {
            top = r.top - tooltipHeight - margin;
            if (top < viewportPad) {
                placed = 'bottom';
                top = r.bottom + margin;
            }
        } else {
            top = r.bottom + margin;
            if (top + tooltipHeight > window.innerHeight - viewportPad) {
                placed = 'top';
                top = r.top - tooltipHeight - margin;
            }
        }

        let left = r.left;
        const maxLeft = window.innerWidth - tooltipWidth - viewportPad;
        if (left > maxLeft) left = maxLeft;
        if (left < viewportPad) left = viewportPad;

        setCoords({ top, left, placed });
    }, [side, width]);

    useEffect(() => {
        if (!open) return;
        updateCoords();
        const raf = requestAnimationFrame(updateCoords);

        const onScroll = () => updateCoords();
        const onDocClick = (e: MouseEvent) => {
            const target = e.target as Node;
            if (triggerRef.current?.contains(target)) return;
            if (tooltipRef.current?.contains(target)) return;
            setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };

        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onScroll);
        document.addEventListener('mousedown', onDocClick);
        document.addEventListener('keydown', onKey);
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onScroll);
            document.removeEventListener('mousedown', onDocClick);
            document.removeEventListener('keydown', onKey);
        };
    }, [open, updateCoords]);

    const tooltipWidth = WIDTH_PX[width];

    return (
        <>
            <button
                ref={triggerRef}
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
            {open && typeof document !== 'undefined' && createPortal(
                <div
                    ref={tooltipRef}
                    role="tooltip"
                    style={{
                        position: 'fixed',
                        top: coords.top,
                        left: coords.left,
                        width: tooltipWidth,
                        maxWidth: tooltipWidth,
                    }}
                    className="z-[1000] px-3 py-2 rounded-lg bg-dark-900/[0.98] backdrop-blur-xl border border-white/[0.10] shadow-2xl shadow-black/40 text-[0.8125rem] text-gray-200 leading-relaxed font-normal normal-case tracking-normal pointer-events-none animate-fade-in"
                    data-side={coords.placed}
                >
                    {content}
                </div>,
                document.body,
            )}
        </>
    );
}
