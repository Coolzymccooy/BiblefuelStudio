import { useEffect, useRef, useState } from 'react';
import { Play, Pause, AudioLines } from 'lucide-react';

// A fixed waveform silhouette — a sine base with a little per-bar texture so it
// reads as a real audio wave rather than a flat equaliser.
const BARS = Array.from({ length: 44 }, (_, i) => {
    const base = Math.sin(i * 0.45) * 0.5 + 0.5;
    const texture = (((i * 7) % 5) / 5) * 0.4;
    return Math.max(0.18, Math.min(1, base * 0.78 + texture));
});

interface VoicePlayerProps {
    src: string;
    label: string;
    kindLabel?: string;
}

/**
 * The Voice & Audio "now playing" card: a gold player for the current track.
 * Play toggles a real <audio> element and animates the waveform (bfbars scaleY,
 * per-bar delay) while it plays.
 */
export function VoicePlayer({ src, label, kindLabel }: VoicePlayerProps) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [playing, setPlaying] = useState(false);
    const [progress, setProgress] = useState(0); // 0..1

    // Reset when the track changes.
    useEffect(() => {
        setPlaying(false);
        setProgress(0);
    }, [src]);

    const toggle = () => {
        const a = audioRef.current;
        if (!a) return;
        if (a.paused) a.play().catch(() => setPlaying(false));
        else a.pause();
    };

    return (
        <div className="glass-float relative overflow-hidden rounded-bf-lg p-4">
            {/* Neutral frosted surface (glass-float, ~0.86 opaque + blur) so
                scrolling content can't bleed into the waveform. Gold lives only
                in the play button + waveform below — an accent, not a wash. */}
            <audio
                ref={audioRef}
                src={src}
                preload="metadata"
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => { setPlaying(false); setProgress(0); }}
                onTimeUpdate={(e) => {
                    const a = e.currentTarget;
                    if (a.duration) setProgress(a.currentTime / a.duration);
                }}
            />

            <div className="flex items-center gap-3">
                <button
                    onClick={toggle}
                    aria-label={playing ? 'Pause' : 'Play'}
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[#221703] shadow-[0_10px_22px_-8px_rgba(216,184,120,0.6)]"
                    style={{ background: 'linear-gradient(180deg,#e9cd8d,#cba85f)' }}
                >
                    {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-0.5" />}
                </button>

                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-bf-goldDeep">
                        <AudioLines size={12} /> Now playing
                    </div>
                    <div className="mt-0.5 truncate font-semibold text-[14px] text-bf-cream">{label}</div>
                    {kindLabel && <div className="text-[11px] text-bf-muted">{kindLabel}</div>}
                </div>
            </div>

            {/* Waveform */}
            <div className="mt-3.5 flex h-11 items-center gap-[3px]">
                {BARS.map((h, i) => {
                    const played = i / BARS.length <= progress;
                    return (
                        <span
                            key={i}
                            className={`flex-1 rounded-full ${playing ? 'animate-bfbars' : ''}`}
                            style={{
                                height: `${Math.round(h * 100)}%`,
                                transformOrigin: 'center',
                                animationDelay: playing ? `${(i % 12) * 0.06}s` : undefined,
                                background: played ? '#e6c98a' : 'rgba(216,184,120,0.28)',
                            }}
                        />
                    );
                })}
            </div>
        </div>
    );
}
