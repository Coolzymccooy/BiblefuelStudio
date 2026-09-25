import { Loader2, Music, Play, Plus, Square, Upload } from 'lucide-react';
import { formatDuration, humanDuration, type SoundtrackStats } from '../../lib/soundtrack';
import type { TrackListVariant } from './TrackRow';

export interface RibbonSegment {
  key: string;
  label: string;
  sec: number;
  colour: string;
}

interface SoundtrackHeaderProps {
  variant: TrackListVariant;
  stats: SoundtrackStats;
  /** Video length; without it the header shows the music total only. */
  targetSec?: number | null;
  trackCount: number;
  segments: RibbonSegment[];
  shuffle: boolean;
  playingAll: boolean;
  canPlayAll: boolean;
  onPlayAll: () => void;
  onAddLibrary: () => void;
  onUpload: () => void;
  uploading: boolean;
  disabled: boolean;
}

/** More than this many passes reads as "repeats"; just under 1.0 is a fit. */
const REPEAT_THRESHOLD = 1.05;

function Ribbon({ segments, thin }: { segments: RibbonSegment[]; thin: boolean }) {
  if (segments.length === 0) return null;
  return (
    <div className={`flex w-full gap-[2px] overflow-hidden rounded-md ${thin ? 'h-1.5' : 'h-6'}`} aria-hidden="true">
      {segments.map((s) => (
        <div key={s.key} className="flex min-w-[3px] items-center overflow-hidden px-1.5 text-[10px] text-white" style={{ flex: s.sec, backgroundColor: s.colour }} title={`${s.label} · ${formatDuration(s.sec)}`}>
          {!thin && <span className="truncate">{s.label}</span>}
        </div>
      ))}
    </div>
  );
}

/**
 * The top of a music list: how long the music runs, how that fits the video,
 * and the list's main actions. The repeat warning is the point — a 2-hour
 * video over 18 minutes of music plays every song six or seven times.
 */
export function SoundtrackHeader(props: SoundtrackHeaderProps) {
  const { variant, stats, targetSec, trackCount, segments, shuffle, playingAll, canPlayAll, onPlayAll, onAddLibrary, onUpload, uploading, disabled } = props;
  const repeats = stats.repeats !== null && stats.repeats >= REPEAT_THRESHOLD ? stats.repeats : null;
  const fits = stats.repeats !== null && stats.repeats < REPEAT_THRESHOLD;
  const tracks = `${trackCount} ${trackCount === 1 ? 'track' : 'tracks'}`;

  const fitNote = repeats !== null
    ? <b className="font-semibold text-amber-600">repeats {repeats.toFixed(1)}×</b>
    : fits ? <b className="font-semibold text-bf-success">fills the video</b> : null;

  const shortfall = repeats !== null && stats.shortfallSec ? (
    <p className="rounded-md bg-amber-500/10 px-2.5 py-1.5 text-[11.5px] text-amber-600">
      Add about {humanDuration(stats.shortfallSec)} more music and nothing repeats in the {formatDuration(targetSec)} video.
    </p>
  ) : null;

  const unknown = stats.unknownCount > 0 && (
    <span className="text-bf-faint"> · {stats.unknownCount} without a length yet</span>
  );

  const actions = (
    <>
      <button type="button" onClick={onPlayAll} disabled={!canPlayAll} aria-pressed={playingAll} className={variant === 'full'
        ? 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-bf-gold px-3 py-1.5 text-xs font-semibold text-bf-bg transition hover:opacity-90 disabled:opacity-40'
        : 'inline-flex items-center gap-1 rounded-md border border-[rgba(216,184,120,0.3)] px-2 py-1 text-bf-cream hover:border-bf-gold disabled:opacity-40'}>
        {playingAll ? <Square size={12} /> : <Play size={12} />} {playingAll ? 'Stop' : 'Play all'}
      </button>
      <button type="button" onClick={onAddLibrary} disabled={disabled} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[rgba(216,184,120,0.3)] px-3 py-1.5 text-xs text-bf-cream transition hover:border-bf-gold disabled:opacity-40">
        <Plus size={12} /> Add from library…
      </button>
      <button type="button" onClick={onUpload} disabled={disabled || uploading} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[rgba(216,184,120,0.3)] px-3 py-1.5 text-xs text-bf-cream transition hover:border-bf-gold disabled:opacity-40">
        {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} {uploading ? 'Uploading…' : 'Upload'}
      </button>
    </>
  );

  if (variant === 'compact') {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2"><Music size={14} className="text-bf-gold" /> <span className="font-medium text-bf-cream">Background music</span>
          <span className="text-bf-muted">· {shuffle ? 'shuffled' : 'plays in order'}, then loops to fill</span>
        </div>
        {trackCount > 0 && (
          <div className="text-[11.5px] text-bf-sub">
            <span className="font-mono text-bf-cream">{formatDuration(stats.totalSec)}</span> of music · {tracks}{fitNote && <> · {fitNote}</>}{unknown}
          </div>
        )}
        <Ribbon segments={segments} thin />
        <div className="flex flex-wrap items-center gap-1.5">{actions}</div>
      </div>
    );
  }

  return (
    <section aria-label="Soundtrack" className="flex flex-col gap-4 rounded-2xl border border-[rgba(216,184,120,0.22)] bg-gradient-to-r from-[rgba(216,184,120,0.10)] to-transparent p-4 sm:flex-row sm:items-center">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#755c2a] to-[#c9a86a] text-2xl text-white shadow-md" aria-hidden="true">♫</div>
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-bf-gold">Soundtrack{shuffle ? ' · shuffled' : ''}</div>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-displaySerif text-4xl leading-none text-bf-cream">{formatDuration(stats.totalSec)}</span>
            <span className="text-[12px] text-bf-muted">
              of music{targetSec ? <> · video <span className="font-mono">{formatDuration(targetSec)}</span></> : null} · {tracks}{fitNote && <> · {fitNote}</>}{unknown}
            </span>
          </div>
        </div>
        <Ribbon segments={segments} thin={false} />
        {shortfall}
      </div>
      <div className="flex shrink-0 flex-row flex-wrap gap-2 sm:flex-col">{actions}</div>
    </section>
  );
}
