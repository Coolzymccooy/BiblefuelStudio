import { useRef, type ReactNode } from 'react';
import { AUDIO_ACCEPT, AUDIO_ACCEPT_LIST } from '../lib/audioAccept';
import { Music, X, Loader2, Play, Square, ArrowDownToLine } from 'lucide-react';
import { trackAudioUrl, useTrackPreview } from '../hooks/useTrackPreview';
import { DropZone } from './ui/DropZone';
import { InstrumentalDialog } from './InstrumentalDialog';
import { MusicTracklist } from './music/MusicTracklist';
import { refId, useLibraryActions } from './music/useLibraryActions';
import type { TrackListVariant } from './music/TrackRow';

/**
 * `paths` is the multi-track form (ordered). `path` stays for back-compat —
 * single-track callers read it; multi-track callers read `paths` (with `path`
 * mirroring `paths[0]`).
 */
export interface MusicValue { path: string | null; paths?: string[]; volume: number; autoDuck?: boolean }

interface MusicPickerProps {
  value: MusicValue;
  onChange: (next: MusicValue) => void;
  busy: boolean;
  /** Allow an ordered list of tracks (played back-to-back, then looped). */
  multiple?: boolean;
  /** Fixed playback order: chosen tracks can be dragged and moved. */
  reorderable?: boolean;
  /** Multiple mode only: the list is a pool played in random order. */
  shuffle?: boolean;
  /** Host timeline: put the chosen track on the Music bed lane. */
  onInsertToLane?: (path: string) => void;
  /** Multiple mode only: the page-wide album layout, or compact for a side panel. */
  variant?: TrackListVariant;
  /** Multiple mode only: the video length, for the "repeats N×" figure. */
  targetSec?: number | null;
  /** Multiple mode only: the crossfade, so the total matches the render. */
  crossfadeSec?: number;
  /** Multiple mode, full layout: host settings for the bar above the list. */
  toolbar?: ReactNode;
}

export function MusicPicker(props: MusicPickerProps) {
  if (props.multiple) {
    return (
      <MusicTracklist
        value={props.value}
        onChange={props.onChange}
        busy={props.busy}
        reorderable={Boolean(props.reorderable)}
        shuffle={Boolean(props.shuffle)}
        variant={props.variant ?? 'compact'}
        targetSec={props.targetSec}
        crossfadeSec={props.crossfadeSec}
        toolbar={props.toolbar}
      />
    );
  }
  return <SingleMusicPicker {...props} />;
}

/** One track: the default, a pick from the library, or an upload. */
function SingleMusicPicker({ value, onChange, busy, onInsertToLane }: MusicPickerProps) {
  const lib = useLibraryActions();
  const player = useTrackPreview();
  const inputRef = useRef<HTMLInputElement>(null);
  const autoDuck = value.autoDuck ?? true;
  const tracks = lib.tracks;
  const defaultTrack = tracks.find((t) => t.default);
  const currentId = refId(value.path);
  const current = tracks.find((t) => t.id === currentId);
  const currentUrl = trackAudioUrl(current);
  const playing = player.playingId === currentId && currentId !== '';

  const upload = async (file: File) => {
    const ref = await lib.uploadFile(file);
    if (ref) onChange({ path: ref, volume: value.volume ?? 0.3, autoDuck });
  };

  // Every library track (bundled + this account's uploads), so an unrecorded
  // licence can be badged and a saved upload can be forgotten.
  const libraryList = tracks.length > 0 && (
    <ul className="max-h-32 space-y-1 overflow-y-auto rounded-md border border-[rgba(216,184,120,0.18)] bg-bf-card p-1.5">
      {tracks.map((t) => (
        <li key={t.id} className="flex items-center gap-1.5 px-1 py-0.5">
          <span className="flex-1 truncate">{t.label}</span>
          {lib.manageControls(t)}
        </li>
      ))}
    </ul>
  );

  return (
    <DropZone
      className="space-y-2 rounded-lg border border-[rgba(216,184,120,0.18)] bg-bf-card p-3 text-xs text-bf-sub"
      onFiles={(files) => { if (files[0]) upload(files[0]); }}
      accept={AUDIO_ACCEPT_LIST}
      multiple={false}
      disabled={busy || lib.isUploading}
      overlayLabel="Drop a music track"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2"><Music size={14} className="shrink-0 text-bf-gold" /> <span className="truncate font-medium text-bf-cream">Background music</span></div>
        {value.path && (
          <button
            type="button"
            onClick={() => { player.stop(); onChange({ path: null, volume: value.volume, autoDuck }); }}
            aria-label="Remove music"
            title="Remove music — the render goes out without a music bed"
            className="shrink-0 rounded-md border border-[rgba(216,184,120,0.25)] p-1 text-bf-muted transition hover:text-bf-cream"
          >
            <X size={12} />
          </button>
        )}
      </div>

      <label className="flex items-center gap-2" title={defaultTrack ? `Use the default bed: ${defaultTrack.label}` : undefined}>
        <input
          type="checkbox"
          checked={!!currentId && currentId === defaultTrack?.id}
          aria-label="use default audio"
          onChange={(e) => onChange(e.target.checked && defaultTrack
            ? { path: defaultTrack.ref, volume: value.volume ?? 0.3, autoDuck }
            : { path: null, volume: value.volume ?? 0.3, autoDuck })}
        />
        <span className="truncate">Use default{defaultTrack ? ` (${defaultTrack.label})` : ''}</span>
      </label>

      <div className="flex items-center gap-1.5">
        <select
          aria-label="music library"
          title="Music library"
          value={currentId}
          onChange={(e) => {
            const id = e.target.value;
            const t = id ? tracks.find((x) => x.id === id) : undefined;
            player.stop();
            onChange(t ? { path: t.ref, volume: value.volume ?? 0.3, autoDuck } : { path: null, volume: value.volume ?? 0.3, autoDuck });
          }}
          className="min-w-0 flex-1 rounded-md border border-[rgba(216,184,120,0.25)] bg-transparent px-2 py-1 text-bf-cream"
        >
          <option value="">— pick from the library —</option>
          {tracks.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        {currentId && currentUrl && (
          <button
            type="button"
            onClick={() => player.preview({ id: currentId, url: currentUrl })}
            aria-label={playing ? 'Stop preview' : 'Preview'}
            aria-pressed={playing}
            title={playing ? 'Stop' : 'Preview this track'}
            className={`shrink-0 rounded-md border p-1.5 transition ${playing ? 'border-editor-accent/60 bg-editor-accent/15 text-editor-accent' : 'border-[rgba(216,184,120,0.25)] text-bf-muted hover:text-bf-cream'}`}
          >
            {playing ? <Square size={12} /> : <Play size={12} />}
          </button>
        )}
      </div>

      {libraryList}
      {lib.instrumentalFor && (
        <InstrumentalDialog
          track={lib.instrumentalFor}
          onClose={() => lib.setInstrumentalFor(null)}
          onSaved={lib.refresh}
          onUse={(inst) => {
            onChange({ path: inst.ref, volume: value.volume ?? 0.3, autoDuck });
            lib.setInstrumentalFor(null);
          }}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || lib.isUploading} onClick={() => inputRef.current?.click()} className="rounded-md border border-[rgba(216,184,120,0.25)] px-2 py-1 text-bf-cream hover:border-bf-gold disabled:opacity-50">{lib.isUploading ? 'Uploading…' : 'Upload your own'}</button>
        <input ref={inputRef} type="file" accept={AUDIO_ACCEPT} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
        {(busy || lib.isUploading) && <Loader2 size={12} className="animate-spin" />}
      </div>

      {value.path && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <label className="inline-flex min-w-0 flex-1 items-center gap-1" title="Music volume under the voice">Vol
            <input type="range" min={0} max={1} step={0.05} value={value.volume} onChange={(e) => onChange({ ...value, autoDuck, volume: Number(e.target.value) })} className="min-w-0 flex-1 accent-bf-gold" />
          </label>
          <label className="inline-flex items-center gap-1" title="Lower the music automatically while the voice speaks"><input type="checkbox" checked={autoDuck} aria-label="autoduck" onChange={(e) => onChange({ ...value, autoDuck: e.target.checked })} /> Autoduck</label>
          {onInsertToLane && (
            <button
              type="button"
              onClick={() => value.path && onInsertToLane(value.path)}
              title="Place this track on the Music bed lane of the timeline"
              className="inline-flex items-center gap-1 rounded-md border border-editor-accent/40 bg-editor-accent/10 px-2 py-0.5 text-[11px] font-semibold text-editor-accent transition hover:bg-editor-accent/20"
            >
              <ArrowDownToLine size={11} /> Music bed lane
            </button>
          )}
        </div>
      )}
    </DropZone>
  );
}
