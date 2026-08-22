import { useEffect, useRef, useState } from 'react';
import { Music, X, Loader2, Play, Square } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../lib/api';
import { storyApi } from '../lib/storyApi';
import { useMusicLibrary } from '../hooks/useMusicLibrary';
import { DropZone } from './ui/DropZone';

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
}

export function MusicPicker({ value, onChange, busy, multiple = false }: MusicPickerProps) {
  const { data: tracks } = useMusicLibrary();
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Which track is currently previewing. Without this the button could only
  // ever start playback: clicking the same track again just built a second
  // Audio element, so a preview could not be stopped.
  const [playingId, setPlayingId] = useState<string | null>(null);
  const autoDuck = value.autoDuck ?? true;
  const [isUploading, setIsUploading] = useState(false);
  const defaultTrack = (tracks || []).find((t) => t.default);
  const isLibrary = (value.path || '').startsWith('library:');
  const currentId = isLibrary ? value.path!.slice('library:'.length) : '';

  // Multi-track list (ordered). Falls back to the single `path` for callers
  // that haven't migrated. Emitting keeps `path` in sync with `paths[0]`.
  const paths = value.paths ?? (value.path ? [value.path] : []);
  const emitPaths = (next: string[]) =>
    onChange({ path: next[0] ?? null, paths: next, volume: value.volume ?? 0.3, autoDuck });

  const trackLabel = (p: string) => {
    if (p.startsWith('library:')) {
      const id = p.slice('library:'.length);
      return (tracks || []).find((t) => t.id === id)?.label || id;
    }
    return p.split(/[\\/]/).pop() || p;
  };

  const upload = async (file: File) => {
    if (isUploading) return;
    setIsUploading(true);
    try {
      const path = await storyApi.uploadAudio(file, file.name);
      if (multiple) emitPaths([...paths, path]);
      else onChange({ path, volume: value.volume ?? 0.3, autoDuck });
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
    el.play().catch(() => setPlayingId(null));
  };

  // Never leave audio playing after the picker unmounts.
  useEffect(() => () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
  }, []);

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
                {p.startsWith('library:') && (
                  <button
                    type="button"
                    onClick={() => preview(p.slice('library:'.length))}
                    className="text-gray-400 hover:text-primary-300"
                    aria-label={playingId === p.slice('library:'.length) ? 'Stop preview' : 'Preview'}
                  >
                    {playingId === p.slice('library:'.length) ? <Square size={12} /> : <Play size={12} />}
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
            onChange={(e) => { const id = e.target.value; if (id) emitPaths([...paths, `library:${id}`]); }}
            className="rounded-md border border-white/10 bg-transparent px-2 py-1 text-white"
          >
            <option value="">+ Add from library…</option>
            {(tracks || []).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <button type="button" disabled={busy || isUploading} onClick={() => inputRef.current?.click()} className="rounded-md border border-white/15 px-2 py-1 hover:border-primary-400 disabled:opacity-50">{isUploading ? 'Uploading…' : '+ Upload'}</button>
          <input ref={inputRef} type="file" accept="audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
          {(busy || isUploading) && <Loader2 size={12} className="animate-spin" />}
        </div>

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
      <div className="flex items-center gap-2"><Music size={14} /> <span className="font-medium">Background music</span></div>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={isLibrary && currentId === defaultTrack?.id}
          aria-label="use default audio"
          onChange={(e) => onChange(e.target.checked && defaultTrack
            ? { path: `library:${defaultTrack.id}`, volume: value.volume ?? 0.3, autoDuck }
            : { path: null, volume: value.volume ?? 0.3, autoDuck })}
        />
        Use default audio{defaultTrack ? ` (${defaultTrack.label})` : ''}
      </label>

      <label className="flex items-center gap-2">
        <span>Music library</span>
        <select
          aria-label="music library"
          value={currentId}
          onChange={(e) => {
            const id = e.target.value;
            onChange(id ? { path: `library:${id}`, volume: value.volume ?? 0.3, autoDuck } : { path: null, volume: value.volume ?? 0.3, autoDuck });
          }}
          className="rounded-md border border-white/10 bg-transparent px-2 py-1 text-white"
        >
          <option value="">— none —</option>
          {(tracks || []).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        {currentId && (
          <button
            type="button"
            onClick={() => preview(currentId)}
            className="inline-flex items-center gap-1 text-gray-400 hover:text-primary-300"
          >
            {playingId === currentId ? <><Square size={12} /> stop</> : <><Play size={12} /> preview</>}
          </button>
        )}
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy || isUploading} onClick={() => inputRef.current?.click()} className="rounded-md border border-white/15 px-2 py-1 hover:border-primary-400 disabled:opacity-50">{isUploading ? 'Uploading…' : 'Upload your own'}</button>
        <input ref={inputRef} type="file" accept="audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
        {value.path && (
          <>
            <label className="inline-flex items-center gap-1">Vol
              <input type="range" min={0} max={1} step={0.05} value={value.volume} onChange={(e) => onChange({ ...value, autoDuck, volume: Number(e.target.value) })} className="accent-primary-500" />
            </label>
            <label className="inline-flex items-center gap-1"><input type="checkbox" checked={autoDuck} aria-label="autoduck" onChange={(e) => onChange({ ...value, autoDuck: e.target.checked })} /> Autoduck</label>
            <button type="button" onClick={() => onChange({ path: null, volume: value.volume, autoDuck })} className="inline-flex items-center gap-1 text-gray-400 hover:text-red-300"><X size={12} /> Remove music</button>
          </>
        )}
        {(busy || isUploading) && <Loader2 size={12} className="animate-spin" />}
      </div>
    </DropZone>
  );
}
