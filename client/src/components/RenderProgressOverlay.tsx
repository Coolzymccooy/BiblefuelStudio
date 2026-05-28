import { useEffect, useRef, useState } from 'react';
import { Film, Loader2, Sparkles } from 'lucide-react';

interface RenderProgressOverlayProps {
    /** True while a render is in flight (instant API call OR queued background job). */
    active: boolean;
    /** 0-100 if known (background jobs report this); undefined for instant renders. */
    progress?: number;
    /** Optional label for the kind of render in flight. */
    kind?: 'video' | 'waveform';
    /** Whether the in-flight render is queued (background) or running synchronously. */
    mode?: 'instant' | 'queued';
}

const VIDEO_STAGES = [
    'Preparing your script…',
    'Synthesising voice…',
    'Aligning words to audio…',
    'Compositing background…',
    'Burning in captions…',
    'Encoding H.264…',
    'Almost there…',
];

const WAVEFORM_STAGES = [
    'Analysing audio…',
    'Drawing the waveform…',
    'Encoding the MP4…',
    'Almost there…',
];

function fmtSeconds(s: number): string {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m > 0 ? `${m}m ${r.toString().padStart(2, '0')}s` : `${r}s`;
}

export function RenderProgressOverlay({
    active,
    progress,
    kind = 'video',
    mode = 'instant',
}: RenderProgressOverlayProps) {
    const [elapsed, setElapsed] = useState(0);
    const [stageIdx, setStageIdx] = useState(0);
    const startedAt = useRef<number | null>(null);
    const stages = kind === 'waveform' ? WAVEFORM_STAGES : VIDEO_STAGES;

    useEffect(() => {
        if (!active) {
            startedAt.current = null;
            setElapsed(0);
            setStageIdx(0);
            return;
        }
        startedAt.current = Date.now();
        const tickElapsed = setInterval(() => {
            if (startedAt.current) {
                setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
            }
        }, 1000);
        const tickStage = setInterval(() => {
            setStageIdx((i) => (i + 1) % stages.length);
        }, 4500);
        return () => {
            clearInterval(tickElapsed);
            clearInterval(tickStage);
        };
    }, [active, stages.length]);

    if (!active) return null;

    const hasRealProgress = typeof progress === 'number' && progress >= 0 && progress <= 100;
    const stageMsg = stages[stageIdx];

    return (
        <div className="relative overflow-hidden rounded-2xl border border-primary-500/30 bg-gradient-to-br from-primary-500/[0.08] via-dark-900/80 to-dark-900/80 backdrop-blur-xl shadow-[0_8px_40px_-8px_rgba(176,141,87,0.4)] animate-fade-in">
            <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
                <div className="absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-primary-400/10 to-transparent animate-shimmer-x" />
            </div>

            <div className="pointer-events-none absolute -top-12 -left-12 w-48 h-48 rounded-full bg-primary-500/20 blur-3xl animate-pulse-subtle" />

            <div className="relative z-10 p-5 sm:p-6">
                <div className="flex items-start gap-4">
                    <div className="relative shrink-0">
                        <div className="absolute inset-0 rounded-2xl bg-primary-500/30 blur-md animate-pulse" />
                        <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500/30 to-primary-600/20 border border-primary-400/40 flex items-center justify-center">
                            <Film size={26} className="text-primary-200" />
                        </div>
                    </div>

                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-lg sm:text-xl font-semibold text-white tracking-tight">
                                {kind === 'waveform' ? 'Rendering your waveform' : 'Rendering your video'}
                                <span className="inline-flex items-center ml-1 text-primary-300">
                                    <span className="animate-pulse">.</span>
                                    <span className="animate-pulse [animation-delay:200ms]">.</span>
                                    <span className="animate-pulse [animation-delay:400ms]">.</span>
                                </span>
                            </h3>
                            {mode === 'queued' && (
                                <span className="text-[0.6875rem] font-medium uppercase tracking-wider text-primary-300/80 bg-primary-500/10 border border-primary-500/20 rounded-full px-2 py-0.5">
                                    Background job
                                </span>
                            )}
                        </div>

                        <p className="text-[0.875rem] text-gray-300 mt-1 flex items-center gap-2">
                            <Sparkles size={13} className="text-primary-400 shrink-0 animate-pulse" />
                            <span className="truncate">{stageMsg}</span>
                        </p>

                        <div className="flex items-center gap-4 mt-3 text-[0.75rem] text-gray-400 tabular-nums">
                            <div className="flex items-center gap-1.5">
                                <Loader2 size={12} className="text-primary-400 animate-spin" />
                                <span>Elapsed: <span className="text-gray-200 font-medium">{fmtSeconds(elapsed)}</span></span>
                            </div>
                            {hasRealProgress && (
                                <div>
                                    Progress: <span className="text-primary-300 font-semibold">{Math.round(progress!)}%</span>
                                </div>
                            )}
                        </div>

                        <div className="mt-3 h-1.5 rounded-full bg-white/[0.06] overflow-hidden border border-white/[0.05]">
                            {hasRealProgress ? (
                                <div
                                    className="h-full bg-gradient-to-r from-primary-500 to-primary-300 transition-all duration-500 shadow-[0_0_12px_rgba(176,141,87,0.6)]"
                                    style={{ width: `${Math.max(2, progress!)}%` }}
                                />
                            ) : (
                                <div className="h-full w-1/3 bg-gradient-to-r from-transparent via-primary-400 to-transparent animate-indeterminate" />
                            )}
                        </div>

                        <p className="text-[0.6875rem] text-gray-500 mt-2">
                            Don't refresh — this card disappears when your render is ready.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
