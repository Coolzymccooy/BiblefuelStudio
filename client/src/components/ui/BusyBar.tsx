import { useEffect, useState } from 'react';

interface BusyBarProps {
    /** Short status line shown on the left (e.g. "Trimming…"). */
    label?: string;
    /** Optional helper text under the bar. */
    hint?: string;
    className?: string;
    /**
     * Rough expected duration in ms. When provided, the bar fills toward
     * completion and shows "NN% · ~M:SS left" (capped at 99% until the work
     * actually finishes and the component unmounts). Omit for a pure
     * indeterminate bar + elapsed timer.
     */
    estimatedMs?: number;
}

function fmtClock(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Progress bar for bounded server operations that don't stream real progress
 * (audio trim, transcription). With `estimatedMs` it shows an ETA-driven
 * percentage + time-left; without it, an indeterminate bar + elapsed timer.
 * The ETA is approximate by design (labelled with "~") — it eases to 99% and
 * snaps to done when the parent unmounts the bar. Mount only while in flight;
 * the timer starts on mount and stops on unmount.
 */
export function BusyBar({ label = 'Working…', hint, className = '', estimatedMs }: BusyBarProps) {
    const [elapsedMs, setElapsedMs] = useState(0);

    useEffect(() => {
        const startedAt = Date.now();
        const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 200);
        return () => clearInterval(id);
    }, []);

    const determinate = typeof estimatedMs === 'number' && estimatedMs > 0;
    const pct = determinate ? Math.min(99, Math.round((elapsedMs / estimatedMs!) * 100)) : 0;
    const remainMs = determinate ? estimatedMs! - elapsedMs : 0;

    return (
        <div className={`space-y-1.5 ${className}`}>
            <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-primary-200">{label}</span>
                <span className="font-mono tabular-nums text-content-secondary">
                    {determinate
                        ? (remainMs > 0 ? `${pct}% · ~${fmtClock(remainMs)} left` : `${pct}% · finishing…`)
                        : fmtClock(elapsedMs)}
                </span>
            </div>
            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                {determinate ? (
                    <div
                        className="absolute inset-y-0 left-0 rounded-full bg-primary-400 transition-[width] duration-200 ease-linear"
                        style={{ width: `${pct}%` }}
                    />
                ) : (
                    <div className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-primary-400 animate-indeterminate" />
                )}
            </div>
            {hint && <p className="text-[11px] text-content-tertiary">{hint}</p>}
        </div>
    );
}
