import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Library, Loader2, Music, Play, Square, Upload, X } from 'lucide-react';
import { AUDIO_ACCEPT, AUDIO_ACCEPT_LIST } from '../../lib/audioAccept';
import { formatDuration, trackColour } from '../../lib/soundtrack';
import { trackAudioUrl, useTrackPreview } from '../../hooks/useTrackPreview';
import { DropZone } from '../ui/DropZone';
import { InstrumentalDialog } from '../InstrumentalDialog';
import { LibraryDrawer } from './LibraryDrawer';
import { useLibraryActions } from './useLibraryActions';
import type { MusicValue } from '../MusicPicker';

interface SongCardProps {
  value: MusicValue;
  onChange: (next: MusicValue) => void;
  busy: boolean;
}

const quietBtn = 'inline-flex items-center gap-1.5 rounded-lg border border-[rgba(216,184,120,0.3)] px-3 py-1.5 text-xs text-bf-cream transition hover:border-bf-gold disabled:cursor-not-allowed disabled:border-[rgba(216,184,120,0.15)] disabled:text-bf-muted';

/**
 * One song under a video (Story Video), in the album look: the chosen song as
 * a card with its tile, title, credit, length and licence; the library drawer
 * (shelves, search, pages) to change it; upload, volume and autoduck. The
 * compact picker stays for side panels.
 */
export function SongCard({ value, onChange, busy }: SongCardProps) {
  const lib = useLibraryActions();
  const player = useTrackPreview();
  const inputRef = useRef<HTMLInputElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const autoDuck = value.autoDuck ?? true;
  const volume = value.volume ?? 0.3;
  const path = value.path;
  const current = path ? lib.trackForRef(path) : undefined;
  const label = path ? lib.trackLabel(path) : '';
  const url = path ? trackAudioUrl(current, path) : '';
  const key = path || '';
  const playing = Boolean(key) && player.playingId === key;
  const defaultTrack = lib.tracks.find((t) => t.default);
  const disabled = busy || lib.isUploading;

  const choose = (ref: string | null) => {
    player.stop();
    onChange({ path: ref, volume, autoDuck });
  };
  const upload = async (file: File) => {
    const ref = await lib.uploadFile(file);
    if (ref) choose(ref);
  };

  return (
    <DropZone
      className="rounded-2xl border border-[rgba(216,184,120,0.22)] bg-bf-card p-4"
      onFiles={(files) => { if (files[0]) upload(files[0]); }}
      accept={AUDIO_ACCEPT_LIST}
      multiple={false}
      disabled={disabled}
      overlayLabel="Drop a song"
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-bf-gold">Music · one song under the story</div>

      {path ? (
        <div className="mt-3 flex items-center gap-4">
          <button
            type="button"
            onClick={() => url && player.preview({ id: key, url })}
            disabled={!url}
            aria-label={playing ? `Stop ${label}` : `Play ${label}`}
            aria-pressed={playing}
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl text-[#fff] shadow-md transition hover:brightness-110 disabled:opacity-60"
            style={{ backgroundColor: trackColour(label) }}
          >
            {playing ? <Square size={18} /> : <Play size={18} />}
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate font-displaySerif text-xl text-bf-cream" title={label}>{label}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-bf-muted">
              <span>{current?.credit || (current?.source === 'upload' ? 'Your upload' : 'Not in your library')}</span>
              {current?.durationSec ? <span className="font-mono text-bf-sub">{formatDuration(current.durationSec)}</span> : null}
              {current && lib.manageControls(current)}
            </div>
          </div>
          <button
            type="button"
            onClick={() => choose(null)}
            aria-label="Remove music"
            title="Remove music — the render goes out without a music bed"
            className="shrink-0 rounded-md p-1.5 text-bf-muted transition hover:text-bf-danger"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-bf-card2 text-bf-gold"><Music size={20} /></div>
          <div className="text-sm text-bf-sub">No music yet. The story plays with its voice alone until you choose a song.</div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setDrawerOpen(true)} disabled={disabled} className={quietBtn}>
          <Library size={12} /> {path ? 'Change song…' : 'Choose from library…'}
        </button>
        {!path && defaultTrack && (
          <button type="button" onClick={() => choose(defaultTrack.ref)} disabled={disabled} className={quietBtn}>
            <Music size={12} /> Use the default ({defaultTrack.label})
          </button>
        )}
        <button type="button" onClick={() => inputRef.current?.click()} disabled={disabled} className={quietBtn}>
          {lib.isUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} {lib.isUploading ? 'Uploading…' : 'Upload a song'}
        </button>
        <input ref={inputRef} type="file" accept={AUDIO_ACCEPT} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
      </div>

      {path && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-bf-sub">
          <label className="inline-flex min-w-[12rem] flex-1 items-center gap-2" title="Music volume under the voice">
            Volume
            <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => onChange({ ...value, autoDuck, volume: Number(e.target.value) })} className="min-w-0 flex-1 accent-bf-gold" />
          </label>
          <label className="inline-flex items-center gap-1.5" title="Lower the music automatically while the voice speaks">
            <input type="checkbox" checked={autoDuck} aria-label="autoduck" onChange={(e) => onChange({ ...value, autoDuck: e.target.checked })} className="accent-bf-gold" /> Autoduck
          </label>
        </div>
      )}

      {drawerOpen && (
        <LibraryDrawer
          single
          onClose={() => setDrawerOpen(false)}
          tracks={lib.tracks}
          exclude={current ? [current.ref] : []}
          onAdd={(refs) => { if (refs[0]) choose(refs[0]); }}
          playingId={player.playingId}
          canPreview={(t) => Boolean(trackAudioUrl(t))}
          onPreview={(t) => player.preview({ id: t.ref, url: trackAudioUrl(t) })}
          renderActions={lib.manageControls}
        />
      )}

      {lib.instrumentalFor && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg">
            <InstrumentalDialog
              track={lib.instrumentalFor}
              onClose={() => lib.setInstrumentalFor(null)}
              onSaved={lib.refresh}
              onUse={(inst) => { choose(inst.ref); lib.setInstrumentalFor(null); }}
            />
          </div>
        </div>,
        document.body,
      )}
    </DropZone>
  );
}
