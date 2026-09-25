import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Play, Search, Square, X } from 'lucide-react';
import type { MusicTrack } from '../../lib/musicLibraryApi';
import { formatDuration, trackColour } from '../../lib/soundtrack';
import { pageWindow, storedPageSize, storePageSize } from '../../lib/pagination';
import { Pager } from '../ui/Pager';

interface LibraryDrawerProps {
  onClose: () => void;
  tracks: readonly MusicTrack[];
  /** Refs already in the list; they aren't offered again. */
  exclude: readonly string[];
  onAdd: (refs: string[]) => void;
  playingId: string | null;
  canPreview: (t: MusicTrack) => boolean;
  onPreview: (t: MusicTrack) => void;
  /** Per-track management controls (licence, credit, remove vocals, forget). */
  renderActions?: (t: MusicTrack) => ReactNode;
}

const lengthSuffix = (sec: number | null) => (Number(sec) > 0 ? ` · ${formatDuration(sec)}` : '');

const MOOD = 'mood:';
const KINDS: ReadonlyArray<{ id: string; label: string; test: (t: MusicTrack) => boolean }> = [
  { id: 'instrumentals', label: 'Vocals removed', test: (t) => Boolean(t.derivedFrom) },
  { id: 'uploads', label: 'My uploads', test: (t) => t.source === 'upload' && !t.derivedFrom },
];

const FOCUSABLE ='button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * The library as a side drawer: search, filter by kind or mood, preview, tick several
 * and add them in library order. A two-hour bed wants a dozen or more tracks,
 * so picking is many-at-once. Mounted only while open, so each opening starts
 * clean; it is modal — focus moves in, Tab stays in, and closing hands focus
 * back to whatever opened it.
 */
export function LibraryDrawer({ onClose, tracks, exclude, onAdd, playingId, canPreview, onPreview, renderActions }: LibraryDrawerProps) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState('');
  // null is everything; otherwise one of the kinds below or `mood:<name>`.
  const [view, setViewState] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(storedPageSize);
  // A new search or shelf starts from its first page.
  const setView = (v: string | null) => { setViewState(v); setPage(1); };
  const search = (q: string) => { setQuery(q); setPage(1); };
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    searchRef.current?.focus();
    return () => { opener?.focus?.(); };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab' || !panelRef.current) return;
    const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const offered = useMemo(() => tracks.filter((t) => !exclude.includes(t.ref)), [tracks, exclude]);
  const moods = useMemo(() => [...new Set(offered.map((t) => t.mood).filter(Boolean))].sort(), [offered]);
  // The operator's own music gets its own shelves: the instrumentals Biblefuel
  // made by removing vocals, and their other uploads.
  const kinds = useMemo(() => KINDS.filter((k) => offered.some(k.test)), [offered]);
  const inView = (t: MusicTrack) => {
    if (!view) return true;
    const kind = KINDS.find((k) => k.id === view);
    return kind ? kind.test(t) : t.mood === view.slice(MOOD.length);
  };
  const q = query.trim().toLowerCase();
  const shown = offered.filter((t) => inView(t)
    && (!q || t.label.toLowerCase().includes(q) || (t.credit || '').toLowerCase().includes(q)));
  const count = offered.filter((t) => picked.has(t.ref)).length;
  const w = pageWindow(shown.length, page, pageSize);
  const pageRows = shown.slice(w.start, w.end);
  const changeSize = (size: number) => {
    setPage(Math.floor(w.start / size) + 1);
    setPageSize(size);
    storePageSize(size);
  };

  const toggle = (ref: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(ref)) next.delete(ref); else next.add(ref);
    return next;
  });
  const add = () => {
    const refs = offered.filter((t) => picked.has(t.ref)).map((t) => t.ref);
    if (refs.length) onAdd(refs);
    onClose();
  };
  const chip = (on: boolean) => `rounded-full border px-2.5 py-0.5 text-[11px] transition ${on
    ? 'border-bf-gold bg-bf-gold text-bf-bg'
    : 'border-[rgba(216,184,120,0.3)] text-bf-sub hover:border-bf-gold'}`;

  // Portalled: the page's entrance animation leaves a transform on an
  // ancestor, which would pin a `fixed` drawer to the page column instead of
  // the window.
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Music library" onKeyDown={onKeyDown} className="relative flex h-full w-full max-w-md flex-col border-l border-[rgba(216,184,120,0.25)] bg-bf-bg shadow-2xl">
        <div className="flex items-center justify-between border-b border-[rgba(216,184,120,0.18)] px-4 py-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-bf-gold">Library</div>
            <div className="font-displaySerif text-xl text-bf-cream">Add music</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-bf-muted hover:text-bf-cream"><X size={16} /></button>
        </div>

        <div className="space-y-2 px-4 py-3">
          <label className="flex items-center gap-2 rounded-lg border border-[rgba(216,184,120,0.25)] bg-bf-card px-2.5 py-1.5">
            <Search size={13} className="text-bf-muted" />
            <input ref={searchRef} value={query} onChange={(e) => search(e.target.value)} placeholder="Search title or credit" aria-label="Search music" className="w-full bg-transparent text-sm text-bf-cream outline-none placeholder:text-bf-faint" />
          </label>
          {(moods.length > 1 || kinds.length > 0) && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
              <button type="button" aria-pressed={view === null} onClick={() => setView(null)} className={chip(view === null)}>All</button>
              {kinds.map((k) => (
                <button key={k.id} type="button" aria-pressed={view === k.id} onClick={() => setView(k.id)} className={chip(view === k.id)}>
                  {k.label} ({offered.filter(k.test).length})
                </button>
              ))}
              {moods.length > 1 && moods.map((m) => (
                <button key={m} type="button" aria-pressed={view === `${MOOD}${m}`} onClick={() => setView(`${MOOD}${m}`)} className={chip(view === `${MOOD}${m}`)}>{m}</button>
              ))}
            </div>
          )}
          {shown.length > 0 && (
            <div className="flex items-center gap-3 text-xs">
              {/* What's on screen, not the whole library: under a filter the
                  operator is choosing from what they can see. */}
              <button type="button" onClick={() => setPicked((prev) => new Set([...prev, ...shown.map((t) => t.ref)]))} className="text-bf-gold hover:underline">Select all ({shown.length})</button>
              <button type="button" onClick={() => setPicked(new Set())} className="text-bf-muted hover:underline">Clear</button>
            </div>
          )}
        </div>

        <div role="group" aria-label="Library tracks" className="min-h-0 flex-1 overflow-y-auto px-2">
          {offered.length === 0 && <p className="px-2 py-6 text-center text-sm text-bf-muted">Every library track is already in the list.</p>}
          {offered.length > 0 && shown.length === 0 && <p className="px-2 py-6 text-center text-sm text-bf-muted">Nothing matches.</p>}
          <ul className="space-y-0.5">
            {pageRows.map((t) => {
              const playing = playingId === t.ref;
              const playable = canPreview(t);
              return (
                <li key={t.ref} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-bf-card2 ${picked.has(t.ref) ? 'bg-bf-card2' : ''}`}>
                  <input type="checkbox" checked={picked.has(t.ref)} onChange={() => toggle(t.ref)} aria-label={`${t.label}${lengthSuffix(t.durationSec)}`} className="accent-bf-gold" />
                  <button
                    type="button"
                    disabled={!playable}
                    onClick={() => onPreview(t)}
                    aria-label={playing ? `Stop ${t.label}` : `Preview ${t.label}`}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[#fff] disabled:opacity-60"
                    style={{ backgroundColor: trackColour(t.label) }}
                  >
                    {playing ? <Square size={11} /> : <Play size={11} />}
                  </button>
                  <button type="button" onClick={() => toggle(t.ref)} className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-[13px] font-medium text-bf-cream">{t.label}</span>
                    <span className="block truncate text-[11px] text-bf-muted">{[t.derivedFrom ? 'Vocals removed by Biblefuel' : '', t.credit, t.mood].filter(Boolean).join(' · ') || (t.source === 'upload' ? 'Your upload' : '')}</span>
                  </button>
                  <span className="shrink-0 font-mono text-[11px] text-bf-sub">{formatDuration(t.durationSec)}</span>
                  {renderActions?.(t)}
                </li>
              );
            })}
          </ul>
          {shown.length > 0 && (
            <Pager label="library" total={shown.length} window={w} pageSize={pageSize} onPage={setPage} onPageSize={changeSize} />
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-[rgba(216,184,120,0.18)] px-4 py-3">
          <button type="button" disabled={count === 0} onClick={add} className="rounded-lg bg-bf-gold px-3 py-1.5 text-xs font-semibold text-bf-bg disabled:cursor-not-allowed disabled:bg-bf-card2 disabled:text-bf-muted disabled:hover:opacity-100">
            Add {count} {count === 1 ? 'track' : 'tracks'}
          </button>
          <button type="button" onClick={onClose} className="px-2 py-1 text-xs text-bf-muted hover:text-bf-cream">Cancel</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
