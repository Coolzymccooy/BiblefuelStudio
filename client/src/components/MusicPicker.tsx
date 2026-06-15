import { useRef, useState } from 'react';
import { Music, X, Loader2, Play } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../lib/api';
import { storyApi } from '../lib/storyApi';
import { useMusicLibrary } from '../hooks/useMusicLibrary';
import { DropZone } from './ui/DropZone';

export interface MusicValue { path: string | null; volume: number; autoDuck?: boolean }

interface MusicPickerProps {
  value: MusicValue;
  onChange: (next: MusicValue) => void;
  busy: boolean;
}

export function MusicPicker({ value, onChange, busy }: MusicPickerProps) {
  const { data: tracks } = useMusicLibrary();
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const autoDuck = value.autoDuck ?? true;
  const [isUploading, setIsUploading] = useState(false);
  const defaultTrack = (tracks || []).find((t) => t.default);
  const isLibrary = (value.path || '').startsWith('library:');
  const currentId = isLibrary ? value.path!.slice('library:'.length) : '';

  const upload = async (file: File) => {
    if (isUploading) return;
    setIsUploading(true);
    try {
      const path = await storyApi.uploadAudio(file, file.name);
      onChange({ path, volume: value.volume ?? 0.3, autoDuck });
      toast.success('Music added');
    } catch (e) { toast.error((e as Error).message || 'Music upload failed'); }
    finally { setIsUploading(false); }
  };

  const preview = (id: string) => {
    const t = (tracks || []).find((x) => x.id === id);
    if (!t) return;
    if (audioRef.current) audioRef.current.pause();
    const el = new Audio(`${api.baseUrl}${t.previewUrl}`);
    audioRef.current = el;
    el.play().catch(() => {});
  };

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
          <button type="button" onClick={() => preview(currentId)} className="inline-flex items-center gap-1 text-gray-400 hover:text-primary-300"><Play size={12} /> preview</button>
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
