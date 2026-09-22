import { useEffect, useRef, useState } from 'react';
import { Music, X, Loader2, Play, Square, ArrowDownToLine } from 'lucide-react';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { storyApi } from '../lib/storyApi';
import { useMusicLibrary } from '../hooks/useMusicLibrary';
import { saveTrackToLibrary, deleteTrack, type MusicTrack } from '../lib/musicLibraryApi';
import { DropZone } from './ui/DropZone';

// A stored value is a ref (`library:<id>` for a bundled track, `mylib:<id>`
// for a saved upload) or, for back-compat, a bare absolute path from before
// uploads were kept in the library. Only the two ref prefixes are recognised
// here — existing bare paths must keep displaying and working untouched.
const REF_PREFIX = /^(library|mylib):/;
const refId = (p: string | null | undefined): string => (p && REF_PREFIX.test(p) ? p.replace(REF_PREFIX, '') : '');

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
  /** Host timeline: put the chosen track on the Music bed lane. */
  onInsertToLane?: (path: string) => void;
}

export function MusicPicker({ value, onChange, busy, multiple = false, onInsertToLane }: MusicPickerProps) {
  const { data: tracks } = useMusicLibrary();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Which track is currently previewing. Without this the button could only
  // ever start playback: clicking the same track again just built a second
  // Audio element, so a preview could not be stopped.
  const [playingId, setPlayingId] = useState<string | null>(null);
  const autoDuck = value.autoDuck ?? true;
  const [isUploading, setIsUploading] = useState(false);
  const defaultTrack = (tracks || []).find((t) => t.default);
  const currentId = refId(value.path);

  // Multi-track list (ordered). Falls back to the single `path` for callers
  // that haven't migrated. Emitting keeps `path` in sync with `paths[0]`.
  const paths = value.paths ?? (value.path ? [value.path] : []);
  const emitPaths = (next: string[]) =>
    onChange({ path: next[0] ?? null, paths: next, volume: value.volume ?? 0.3, autoDuck });

  const trackForRef = (p: string): MusicTrack | undefined => {
    const id = refId(p);
    return id ? (tracks || []).find((t) => t.id === id) : undefined;
  };

  const trackLabel = (p: string) => {
    const t = trackForRef(p);
    if (t) return t.label;
    if (REF_PREFIX.test(p)) return p.replace(REF_PREFIX, '');
    return p.split(/[\\/]/).pop() || p;
  };

  const forgetTrack = async (id: string, label: string) => {
    try {
      await deleteTrack(id);
      qc.invalidateQueries({ queryKey: ['music-library'] });
    } catch (e) {
      toast.error((e as Error).message || `Couldn't forget ${label}`);
    }
  };

  const upload = async (file: File) => {
    if (isUploading) return;
    setIsUploading(true);
    try {
      const path = await storyApi.uploadAudio(file, file.name);
      // Keep it: an upload used to be a loose file attached to one project.
      // Saving it costs nothing here and makes it available to every build.
      // A failed save must not cost the operator their upload — fall back to
      // the raw path exactly as before this track ever reached the library.
      let ref = path;
      try {
        const track = await saveTrackToLibrary(path, { label: file.name.replace(/\.[^.]+$/, '') });
        ref = track.ref;
        qc.invalidateQueries({ queryKey: ['music-library'] });
      } catch {
        // The upload itself succeeded — the project can still use the file.
      }
      if (multiple) emitPaths([...paths, ref]);
      else onChange({ path: ref, volume: value.volume ?? 0.3, autoDuck });
      toast.success('Music added');
    } catch (e) { toast.error((e as Error).message || 'Music upload failed'); }
    finally { setIsUploading(false); }
  };

  const stopPreview = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    setPlayingId(null);
  };

  // Toggle, not play-only. Clicking the playing track stops it; clicking a
  // different one switches to it.
  const preview = (id: string) => {
    if (playingId === id) { stopPreview(); return; }
    const t = (tracks || []).find((x) => x.id === id);
    if (!t) return;
    stopPreview();
    const el = new Audio(`${api.baseUrl}${t.previewUrl}`);
    audioRef.current = el;
    // Reset the control when the clip finishes on its own, or fails to load -
    // otherwise the button would sit on "stop" with nothing playing.
    el.addEventListener('ended', () => setPlayingId(null));
    el.addEventListener('error', () => setPlayingId(null));
    setPlayingId(id);
    // A rejected play() (autoplay policy, blocked output) used to silently
    // snap the button back, which read as 'preview does nothing'. Say so.
    const attempt = el.play();
    if (attempt && typeof attempt.catch === 'function') {
      attempt.catch(() => { setPlayingId(null); toast.error("Couldn't play the preview - check your audio output and try again"); });
    }
  };

  // Never leave audio playing after the picker unmounts.
  useEffect(() => () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
  }, []);

  // Every library track (bundled + this account's uploads), so an unrecorded
  // licence can be badged and a saved upload can be forgotten. This is a
  // management list, independent of which track (if any) is selected above
  // (selecting/previewing stays on the select control to avoid a second,
  // redundant preview affordance per row).
  const libraryList = (tracks || []).length > 0 && (
    <ul className="max-h-32 space-y-1 overflow-y-auto rounded-md border border-white/10 bg-black/10 p-1.5">
      {(tracks || []).map((t) => (
        <li key={t.id} className="flex items-center gap-1.5 px-1 py-0.5">
          <span className="flex-1 truncate">{t.label}</span>
          {t.licence === 'unknown' && (
            <span
              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-amber-300 bg-amber-500/10"
              title="This track's licence is not recorded. On a long music-led video a Content ID claim takes the revenue for the whole video."
            >
              licence?
            </span>
          )}
          {t.source === 'upload' && (
            <button
              type="button"
              aria-label={`Forget ${t.label}`}
              title="Remove from your library. The uploaded file itself is kept."
              onClick={() => forgetTrack(t.id, t.label)}
              className="shrink-0 text-content-tertiary hover:text-bf-danger"
            >
              <X size={12} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );

  if (multiple) {
    return (
      <DropZone
        className="space-y-2 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-xs text-gray-300"
        onFiles={(files) => { if (files[0]) upload(files[0]); }}
        accept={['audio/*', '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac']}
        multiple={false}
        disabled={busy || isUploading}
        overlayLabel="Drop a music track"
      >
        <div className="flex items-center gap-2"><Music size={14} /> <span className="font-medium">Background music</span>
          <span className="text-content-tertiary">· plays in order, then loops to fill the clip</span>
        </div>

        {paths.length > 0 && (
          <ol className="space-y-1">
            {paths.map((p, idx) => (
              <li key={`${p}-${idx}`} className="flex items-center gap-2 rounded-md bg-black/20 border border-white/10 px-2 py-1">
                <span className="w-4 text-center text-[10px] text-content-tertiary">{idx + 1}</span>
                <span className="flex-1 truncate">{trackLabel(p)}</span>
                {trackForRef(p)?.previewUrl && (
                  <button
                    type="button"
                    onClick={() => preview(refId(p))}
                    className="text-gray-400 hover:text-primary-300"
                    aria-label={playingId === refId(p) ? 'Stop preview' : 'Preview'}
                  >
                    {playingId === refId(p) ? <Square size={12} /> : <Play size={12} />}
                  </button>
                )}
                <button type="button" onClick={() => emitPaths(paths.filter((_, i) => i !== idx))} className="text-gray-400 hover:text-red-300" aria-label="remove track"><X size={12} /></button>
              </li>
            ))}
          </ol>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="add music from library"
            value=""
            onChange={(e) => {
              const id = e.target.value;
              const t = id ? (tracks || []).find((x) => x.id === id) : undefined;
              if (t) emitPaths([...paths, t.ref]);
            }}
            className="rounded-md border border-white/10 bg-transparent px-2 py-1 text-white"
          >
            <option value="">+ Add from library…</option>
            {(tracks || []).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <button type="button" disabled={busy || isUploading} onClick={() => inputRef.current?.click()} className="rounded-md border border-white/15 px-2 py-1 hover:border-primary-400 disabled:opacity-50">{isUploading ? 'Uploading…' : '+ Upload'}</button>
          <input ref={inputRef} type="file" accept="audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
          {(busy || isUploading) && <Loader2 size={12} className="animate-spin" />}
        </div>

        {libraryList}

        {paths.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <label className="inline-flex items-center gap-1">Vol
              <input type="range" min={0} max={1} step={0.05} value={value.volume} onChange={(e) => onChange({ ...value, paths, autoDuck, volume: Number(e.target.value) })} className="accent-primary-500" />
            </label>
            <label className="inline-flex items-center gap-1"><input type="checkbox" checked={autoDuck} aria-label="autoduck" onChange={(e) => onChange({ ...value, paths, autoDuck: e.target.checked })} /> Autoduck</label>
            <button type="button" onClick={() => emitPaths([])} className="inline-flex items-center gap-1 text-gray-400 hover:text-red-300"><X size={12} /> Clear all</button>
          </div>
        )}
      </DropZone>
    );
  }

  return (
    <DropZone
      className="space-y-2 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-xs text-gray-300"
      onFiles={(files) => { if (files[0]) upload(files[0]); }}
      accept={['audio/*', '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac']}
      multiple={false}
      disabled={busy || isUploading}
      overlayLabel="Drop a music track"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2"><Music size={14} className="shrink-0" /> <span className="truncate font-medium">Background music</span></div>
        {value.path && (
          <button
            type="button"
            onClick={() => { stopPreview(); onChange({ path: null, volume: value.volume, autoDuck }); }}
            aria-label="Remove music"
            title="Remove music — the render goes out without a music bed"
            className="shrink-0 rounded-md border border-white/10 p-1 text-gray-400 transition hover:border-white/20 hover:text-white"
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
            const t = id ? (tracks || []).find((x) => x.id === id) : undefined;
            stopPreview();
            onChange(t ? { path: t.ref, volume: value.volume ?? 0.3, autoDuck } : { path: null, volume: value.volume ?? 0.3, autoDuck });
          }}
          className="min-w-0 flex-1 rounded-md border border-white/10 bg-transparent px-2 py-1 text-white"
        >
          <option value="">— pick from the library —</option>
          {(tracks || []).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        {currentId && (tracks || []).find((t) => t.id === currentId)?.previewUrl && (
          <button
            type="button"
            onClick={() => preview(currentId)}
            aria-label={playingId === currentId ? 'Stop preview' : 'Preview'}
            aria-pressed={playingId === currentId}
            title={playingId === currentId ? 'Stop' : 'Preview this track'}
            className={`shrink-0 rounded-md border p-1.5 transition ${playingId === currentId ? 'border-editor-accent/60 bg-editor-accent/15 text-editor-accent' : 'border-white/10 text-gray-400 hover:border-white/20 hover:text-white'}`}
          >
            {playingId === currentId ? <Square size={12} /> : <Play size={12} />}
          </button>
        )}
      </div>

      {libraryList}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || isUploading} onClick={() => inputRef.current?.click()} className="rounded-md border border-white/15 px-2 py-1 hover:border-primary-400 disabled:opacity-50">{isUploading ? 'Uploading…' : 'Upload your own'}</button>
        <input ref={inputRef} type="file" accept="audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
        {(busy || isUploading) && <Loader2 size={12} className="animate-spin" />}
      </div>

      {value.path && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <label className="inline-flex min-w-0 flex-1 items-center gap-1" title="Music volume under the voice">Vol
            <input type="range" min={0} max={1} step={0.05} value={value.volume} onChange={(e) => onChange({ ...value, autoDuck, volume: Number(e.target.value) })} className="min-w-0 flex-1 accent-primary-500" />
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
