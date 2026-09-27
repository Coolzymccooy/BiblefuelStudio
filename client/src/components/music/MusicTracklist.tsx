import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AUDIO_ACCEPT, AUDIO_ACCEPT_LIST } from '../../lib/audioAccept';
import { soundtrackStats, trackColour } from '../../lib/soundtrack';
import { trackAudioUrl, useTrackPreview } from '../../hooks/useTrackPreview';
import type { MusicTrack } from '../../lib/musicLibraryApi';
import { DropZone } from '../ui/DropZone';
import { InstrumentalModal } from '../InstrumentalModal';
import { LibraryDrawer } from './LibraryDrawer';
import { SoundtrackHeader, type RibbonSegment } from './SoundtrackHeader';
import { Tracklist } from './Tracklist';
import type { RowMenuItem } from './RowMenu';
import type { TrackListVariant, TrackRowData } from './TrackRow';
import { REF_PREFIX, useLibraryActions } from './useLibraryActions';
import type { MusicValue } from '../MusicPicker';

export interface MusicTracklistProps {
  value: MusicValue;
  onChange: (next: MusicValue) => void;
  busy: boolean;
  /** Fixed playing order: rows can be dragged and moved. */
  reorderable: boolean;
  /** Played in a random order, so the numbers are not the order. */
  shuffle: boolean;
  /** 'full' is the page-wide album layout; 'compact' fits a side panel. */
  variant: TrackListVariant;
  /** Video length, for the "repeats N×" figure. */
  targetSec?: number | null;
  crossfadeSec?: number;
  /** Host settings shown in the bar above the list (full layout). */
  toolbar?: ReactNode;
}

/** A copy of `list` with the item at `from` moved to `to`. */
function move<T>(list: readonly T[], from: number, to: number): T[] {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * An ordered music list (played back-to-back, then looped): the soundtrack
 * header, the tracklist, and the library drawer to fill it.
 */
export function MusicTracklist({ value, onChange, busy, reorderable, shuffle, variant, targetSec, crossfadeSec = 0, toolbar }: MusicTracklistProps) {
  const lib = useLibraryActions();
  const player = useTrackPreview();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const autoDuck = value.autoDuck ?? true;
  const full = variant === 'full';

  // Falls back to the single `path` for callers that haven't migrated.
  // Emitting keeps `path` in sync with `paths[0]`.
  const paths = value.paths ?? (value.path ? [value.path] : []);
  // The list as it is NOW: an upload or a library save can finish after the
  // operator has added, removed or moved tracks, and must build on that.
  const latest = useRef(paths);
  useEffect(() => { latest.current = paths; });
  const emitPaths = (next: string[]) => {
    latest.current = next;
    onChange({ path: next[0] ?? null, paths: next, volume: value.volume ?? 0.3, autoDuck });
  };

  // Put `to` where `from` is (or add it if `from` isn't chosen).
  const swapRef = (from: string, to: string) => {
    const now = latest.current;
    emitPaths(now.includes(from) ? now.map((p) => (p === from ? to : p)) : [...now, to]);
  };

  const upload = async (file: File) => {
    const ref = await lib.uploadFile(file);
    if (ref) emitPaths([...latest.current, ref]);
  };

  // Keys stay stable when rows move, and a track chosen twice still gets two.
  const seen = new Map<string, number>();
  const rows: TrackRowData[] = paths.map((p) => {
    const n = seen.get(p) ?? 0;
    seen.set(p, n + 1);
    const t = lib.trackForRef(p);
    const label = lib.trackLabel(p);
    return {
      key: `${p}#${n}`,
      label,
      subtitle: t?.derivedFrom ? 'vocals removed' : undefined,
      credit: t?.credit || '',
      durationSec: t?.durationSec ?? null,
      licence: t ? (t.licence === 'unknown' ? 'missing' : 'cleared') : null,
      colour: trackColour(label),
      canPlay: Boolean(trackAudioUrl(t, p)),
    };
  });
  const urlAt = (i: number) => trackAudioUrl(lib.trackForRef(paths[i]), paths[i]);

  const stats = soundtrackStats({ durations: rows.map((r) => r.durationSec), crossfadeSec, targetSec });
  const segments: RibbonSegment[] = rows
    .filter((r) => Number(r.durationSec) > 0)
    .map((r) => ({ key: r.key, label: r.label, sec: Number(r.durationSec), colour: r.colour }));
  const missing = rows.filter((r) => r.licence === 'missing').length;
  const cleared = rows.filter((r) => r.licence === 'cleared').length;

  const removeVocalsAt = async (i: number) => {
    const p = paths[i];
    const t = lib.trackForRef(p);
    if (t) { lib.setInstrumentalFor(t); return; }
    const saved = await lib.saveLoose(p);
    if (saved) { swapRef(p, saved.ref); lib.setInstrumentalFor(saved); }
  };

  const menuFor = (i: number): RowMenuItem[] => {
    const p = paths[i];
    const t = lib.trackForRef(p);
    const inst = lib.instrumentalOf(p);
    const loose = !REF_PREFIX.test(p);
    const items: RowMenuItem[] = [];
    if (rows[i].canPlay) items.push({ label: player.playingId === rows[i].key ? 'Stop preview' : 'Preview', onSelect: () => player.preview({ id: rows[i].key, url: urlAt(i) }) });
    if (reorderable) {
      items.push({ label: 'Move up', disabled: busy || i === 0, onSelect: () => emitPaths(move(paths, i, i - 1)) });
      items.push({ label: 'Move down', disabled: busy || i === paths.length - 1, onSelect: () => emitPaths(move(paths, i, i + 1)) });
    }
    if (inst) items.push({ label: 'Use instrumental', onSelect: () => swapRef(p, inst.ref) });
    else if (lib.canRemoveVocals(t) || (loose && lib.caps?.vocalRemoval)) items.push({ label: 'Remove vocals', onSelect: () => { removeVocalsAt(i); } });
    if (t?.source === 'upload') items.push({ label: t.credit ? 'Edit credit' : 'Add credit', onSelect: () => lib.editCredit(t.id, t.credit || '') });
    if (t?.source === 'upload' && t.licence === 'unknown') items.push({ label: 'Mark licence cleared', onSelect: () => lib.clearLicence(t.id, t.label) });
    items.push({ label: 'Remove from list', danger: true, disabled: busy, onSelect: () => emitPaths(paths.filter((_, k) => k !== i)) });
    return items;
  };

  const onLicenceClick = (i: number) => {
    const t = lib.trackForRef(paths[i]);
    if (t) lib.clearLicence(t.id, t.label);
  };

  const jumpToMissing = () => {
    const el = listRef.current?.querySelector<HTMLElement>('[title^="This track\'s licence"]');
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el?.focus();
  };

  const volumeControls = (
    <>
      <label className="inline-flex items-center gap-1.5 text-bf-sub">Volume
        <input type="range" min={0} max={1} step={0.05} value={value.volume} onChange={(e) => onChange({ ...value, paths, autoDuck, volume: Number(e.target.value) })} className="w-24 accent-bf-gold" />
      </label>
      <label className="inline-flex items-center gap-1 text-bf-sub" title="Lower the music automatically while the voice speaks">
        <input type="checkbox" checked={autoDuck} aria-label="autoduck" onChange={(e) => onChange({ ...value, paths, autoDuck: e.target.checked })} /> Autoduck
      </label>
    </>
  );

  const licenceSummary = rows.length > 0 && (
    <span className="text-[11.5px]">
      {cleared > 0 && <span className="text-bf-success">✓ {cleared} cleared</span>}
      {cleared > 0 && missing > 0 && <span className="text-bf-faint"> · </span>}
      {missing > 0 && (
        <button type="button" onClick={jumpToMissing} className="text-bf-warn hover:underline">
          {missing} {missing === 1 ? 'licence' : 'licences'} missing
        </button>
      )}
    </span>
  );

  return (
    <DropZone
      className={`${full ? 'space-y-3' : 'space-y-2 rounded-lg border border-[rgba(216,184,120,0.18)] bg-bf-card p-3'} text-xs text-bf-sub`}
      onFiles={(files) => { if (files[0]) upload(files[0]); }}
      accept={AUDIO_ACCEPT_LIST}
      multiple={false}
      disabled={busy || lib.isUploading}
      overlayLabel="Drop a music track"
    >
      <input ref={inputRef} type="file" accept={AUDIO_ACCEPT} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />

      <SoundtrackHeader
        variant={variant}
        stats={stats}
        targetSec={targetSec}
        trackCount={rows.length}
        segments={segments}
        shuffle={shuffle}
        playingAll={player.playingAll}
        canPlayAll={rows.some((r) => r.canPlay)}
        onPlayAll={() => player.playAll(rows.map((r, i) => ({ id: r.key, url: urlAt(i) })))}
        onAddLibrary={() => setDrawerOpen(true)}
        onUpload={() => inputRef.current?.click()}
        uploading={lib.isUploading}
        disabled={busy || lib.isUploading}
      />

      {full && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-[rgba(216,184,120,0.18)] bg-bf-card px-3 py-2">
          {toolbar}
          {volumeControls}
          <span className="ml-auto">{licenceSummary}</span>
        </div>
      )}

      <div ref={listRef} className={full ? 'rounded-xl border border-[rgba(216,184,120,0.18)] bg-bf-card p-2' : ''}>
        {rows.length === 0 ? (
          <p className={`text-center text-bf-muted ${full ? 'py-10 text-sm' : 'py-3'}`}>
            No music yet — add tracks from your library or upload your own songs.
          </p>
        ) : (
          <Tracklist
            rows={rows}
            variant={variant}
            reorderable={reorderable && !busy}
            onReorder={(from, to) => emitPaths(move(paths, from, to))}
            playingKey={player.playingId}
            onPreview={(i) => player.preview({ id: rows[i].key, url: urlAt(i) })}
            onLicenceClick={onLicenceClick}
            menuFor={menuFor}
          />
        )}
      </div>

      {!full && rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 pt-1">
          {volumeControls}
          {licenceSummary}
          <button type="button" onClick={() => emitPaths([])} className="ml-auto text-bf-muted hover:text-bf-danger">Clear all</button>
        </div>
      )}

      {drawerOpen && <LibraryDrawer
        onClose={() => setDrawerOpen(false)}
        tracks={lib.tracks}
        exclude={paths}
        onAdd={(refs) => emitPaths([...paths, ...refs])}
        playingId={player.playingId}
        canPreview={(t: MusicTrack) => Boolean(trackAudioUrl(t))}
        onPreview={(t: MusicTrack) => player.preview({ id: t.ref, url: trackAudioUrl(t) })}
        renderActions={lib.manageControls}
      />}

      {lib.instrumentalFor && <InstrumentalModal
              track={lib.instrumentalFor}
              onClose={() => lib.setInstrumentalFor(null)}
              // Refresh so the new instrumental shows up in the library right away.
              onSaved={lib.refresh}
              onUse={(inst) => {
                if (lib.instrumentalFor) swapRef(lib.instrumentalFor.ref, inst.ref);
                lib.setInstrumentalFor(null);
              }}
            />}
    </DropZone>
  );
}
