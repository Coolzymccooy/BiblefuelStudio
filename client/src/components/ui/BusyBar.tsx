import { useEffect, useState } from 'react';

interface BusyBarProps {
    /** Short status line shown on the left (e.g. "Trimming…"). */
    label?: string;
    /** Optional helper text under the bar. */
    hint?: string;
    className?: string;
}

function fmtElapsed(ms: number): string {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Indeterminate progress bar with a live elapsed-time counter, for bounded
 * server operations that don't stream incremental progress (audio trim,
 * transcription). Honest by design: it shows motion + how long it's been
 * running rather than faking a percentage. Mount it only while the work is in
 * flight — the timer starts on mount and stops on unmount.
 */
export function BusyBar({ label = 'Working…', hint, className = '' }: BusyBarProps) {
    const [elapsedMs, setElapsedMs] = useState(0);

    useEffect(() => {
        const startedAt = Date.now();
        const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 250);
        return () => clearInterval(id);
    }, []);

    return (
        <div className={`space-y-1.5 ${className}`}>
            <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-primary-200">{label}</span>
                <span className="font-mono tabular-nums text-content-secondary">{fmtElapsed(elapsedMs)}</span>
            </div>
            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-primary-400 animate-indeterminate" />
            </div>
            {hint && <p className="text-[11px] text-content-tertiary">{hint}</p>}
        </div>
    );
}
