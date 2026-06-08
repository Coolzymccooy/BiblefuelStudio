import { useRef } from 'react';
import { Music, X, Loader2 } from 'lucide-react';
import { storyApi } from '../../lib/storyApi';
import toast from 'react-hot-toast';

type MusicValue = { path: string | null; volume: number; autoDuck?: boolean };

interface MusicControlProps {
  music: MusicValue;
  onChange: (next: MusicValue) => void;
  busy: boolean;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function MusicControl({ music, onChange, busy }: MusicControlProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autoDuck = music.autoDuck ?? true;

  const upload = async (file: File) => {
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const path = await storyApi.uploadAudio(dataUrl, file.name);
      onChange({ path, volume: music.volume ?? 0.3, autoDuck });
      toast.success('Music added');
    } catch (e) {
      toast.error((e as Error).message || 'Music upload failed');
    }
  };

  if (!music.path) {
    return (
      <div>
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-1.5 text-xs text-gray-200 hover:border-primary-400 disabled:opacity-50"
        >
          <Music size={14} /> Add background music
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-gray-300">
      <span className="inline-flex items-center gap-1"><Music size={14} /> Music</span>
      <label className="inline-flex items-center gap-1">
        Volume
        <input
          type="range" min={0} max={1} step={0.05} value={music.volume}
          onChange={(e) => onChange({ ...music, autoDuck, volume: Number(e.target.value) })}
          className="accent-primary-500"
        />
      </label>
      <label className="inline-flex items-center gap-1">
        <input
          type="checkbox" checked={autoDuck} aria-label="autoduck"
          onChange={(e) => onChange({ ...music, autoDuck: e.target.checked })}
        />
        Autoduck
      </label>
      <button
        type="button"
        onClick={() => onChange({ path: null, volume: music.volume, autoDuck })}
        className="inline-flex items-center gap-1 text-gray-400 hover:text-red-300"
      >
        <X size={12} /> Remove music
      </button>
      {busy && <Loader2 size={12} className="animate-spin" />}
    </div>
  );
}
