import { useState } from 'react';
import type { MusicTrack } from '../lib/musicLibraryApi';

interface MusicLibraryChecklistProps {
  tracks: readonly MusicTrack[];
  /** Refs already in the list; they aren't offered again. */
  exclude: readonly string[];
  onAdd: (refs: string[]) => void;
  disabled?: boolean;
}

const minutes = (sec: number | null) => {
  if (!(Number(sec) > 0)) return '';
  const s = Math.round(Number(sec));
  return ` · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * "+ Add from library…" as a tick list: a two-hour bed wants a dozen or more
 * tracks, and a dropdown took them one pick at a time. Ticked tracks are added
 * in library order.
 */
export function MusicLibraryChecklist({ tracks, exclude, onAdd, disabled = false }: MusicLibraryChecklistProps) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const offered = tracks.filter((t) => !exclude.includes(t.ref));
  const count = offered.filter((t) => picked.has(t.ref)).length;

  const close = () => { setOpen(false); setPicked(new Set()); };
  const toggle = (ref: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(ref)) next.delete(ref); else next.add(ref);
    return next;
  });
  const add = () => {
    const refs = offered.filter((t) => picked.has(t.ref)).map((t) => t.ref);
    if (refs.length) onAdd(refs);
    close();
  };

  return (
    <div className="w-full">
      <button
        type="button"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        className="rounded-md border border-white/10 px-2 py-1 text-white hover:border-primary-400 disabled:opacity-50"
      >
        + Add from library…
      </button>
      {open && (
        <div role="group" aria-label="Library tracks" className="mt-2 space-y-2 rounded-md border border-white/10 bg-black/20 p-2">
          {offered.length === 0 ? (
            <p className="text-content-tertiary">Every library track is already in the list.</p>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setPicked(new Set(offered.map((t) => t.ref)))} className="text-primary-300 hover:underline">
                  Select all ({offered.length})
                </button>
                <button type="button" onClick={() => setPicked(new Set())} className="text-content-tertiary hover:underline">
                  Clear
                </button>
              </div>
              <ul className="max-h-60 space-y-0.5 overflow-y-auto">
                {offered.map((t) => (
                  <li key={t.ref}>
                    <label className="flex min-h-[32px] cursor-pointer items-center gap-2 rounded px-1 hover:bg-white/5">
                      <input type="checkbox" checked={picked.has(t.ref)} onChange={() => toggle(t.ref)} />
                      <span className="truncate">{t.label}{minutes(t.durationSec)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={count === 0}
              onClick={add}
              className="rounded-md border border-primary-400/60 px-2.5 py-1 font-semibold text-primary-300 hover:border-primary-400 disabled:opacity-40"
            >
              Add {count} {count === 1 ? 'track' : 'tracks'}
            </button>
            <button type="button" onClick={close} className="px-2 py-1 text-content-tertiary hover:text-white">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
