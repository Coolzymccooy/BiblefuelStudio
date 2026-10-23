import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import { Input } from '../ui/Input';
import { toastError } from '../../lib/errors';
import { visualLibraryApi } from '../../lib/sceneScriptApi';
import { ImportClips } from './ImportClips';
import type { LibraryClip, SimilarClip } from '../../lib/sceneScriptTypes';

interface Props {
  aspect: string;
  similar: SimilarClip[];
  onPick: (clipId: string) => void;
  onClose: () => void;
}

function ClipTile({ url, posterUrl, prompt, onPick }: { url: string; posterUrl: string | null; prompt: string; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="group overflow-hidden rounded-lg border border-editor-line bg-bf-card2 text-left hover:border-editor-accent/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-bf-gold"
    >
      <video src={url} poster={posterUrl || undefined} muted preload="metadata" playsInline className="aspect-[9/16] w-full bg-editor-stage object-cover"
        onMouseEnter={(e) => { void e.currentTarget.play().catch(() => {}); }} onMouseLeave={(e) => e.currentTarget.pause()} />
      <p className="line-clamp-3 p-2 text-xs text-bf-sub">{prompt || 'Prompt unknown'}</p>
    </button>
  );
}

/** Choose a clip already paid for. Close matches to this shot's prompt are offered first. */
export function LibraryPicker({ aspect, similar, onPick, onClose }: Props) {
  const [q, setQ] = useState('');
  const [clips, setClips] = useState<LibraryClip[] | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      visualLibraryApi.search(q, aspect).then(setClips).catch((e) => { toastError(e); setClips([]); });
    }, 250);
    return () => clearTimeout(t);
  }, [q, aspect, reload]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-2 sm:p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label="Visual library" className="relative flex max-h-[calc(100dvh-1rem)] w-full max-w-5xl flex-col overflow-hidden rounded-card border border-editor-line bg-bf-card">
        <div className="flex items-center justify-between gap-3 border-b border-editor-line p-4">
          <div>
            <h2 className="text-base font-semibold text-bf-cream">Visual library</h2>
            <p className="text-help">Every clip you have paid for. Using one here costs nothing.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-bf-sub hover:bg-editor-hover hover:text-bf-cream focus-visible:outline focus-visible:outline-2 focus-visible:outline-bf-gold">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="overflow-y-auto p-4 space-y-4">
          {similar.length > 0 && (
            <div>
              <div className="section-title mb-2">Close to this shot</div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                {similar.map((c) => <ClipTile key={c.id} {...c} onPick={() => onPick(c.id)} />)}
              </div>
            </div>
          )}
          <ImportClips onImported={() => setReload((n) => n + 1)} />
          <label className="relative block">
            <span className="sr-only">Search the library</span>
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-bf-muted" aria-hidden="true" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by what is in the shot" className="!pl-9" />
          </label>
          {clips === null ? (
            <p className="text-help">Loading…</p>
          ) : clips.length === 0 ? (
            <p className="text-help">No clips match. Clips appear here once BibleFuel makes them, or once you import them.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {clips.map((c) => <ClipTile key={c.id} url={c.url} posterUrl={c.posterUrl} prompt={c.prompt} onPick={() => onPick(c.id)} />)}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
