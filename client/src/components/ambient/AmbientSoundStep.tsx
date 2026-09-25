import { useState } from 'react';
import toast from 'react-hot-toast';
import { ambientApi, type AmbientBedPatch, type UnclearedTrack } from '../../lib/ambientApi';
import type { AmbientProject } from '../../lib/ambientTypes';
import { MusicPicker, type MusicValue } from '../MusicPicker';
import { MusicLibraryImport } from '../MusicLibraryImport';
import { panelCls, segmentCls, segmentedCls } from '../story/formStyles';

/**
 * Put freshly imported library tracks at the end of a video's bed. Reads the
 * bed fresh: a folder import can end after the step was left or the bed was
 * changed, and the step's own copy would then be stale. Null when there was
 * nothing new to add.
 */
export async function addImportedToBed(projectId: string, refs: readonly string[]) {
  const fresh = await ambientApi.getProject(projectId);
  const current = fresh.bed.trackRefs;
  const additions = refs.filter((r, i) => !current.includes(r) && refs.indexOf(r) === i);
  if (additions.length === 0) return null;
  const patch: AmbientBedPatch = { trackRefs: [...current, ...additions] };
  return { patch, result: await ambientApi.setBed(projectId, patch) };
}

/**
 * A toast, not only the step's banner: a folder import can end after the step
 * was left, and then nobody would see the banner.
 */
export function reportImportGate(uncleared: readonly UnclearedTrack[]) {
  const names = uncleared.map((t) => t.label).join(', ');
  toast.error(
    `Imported tracks weren't added to this video's bed: ${names} ${uncleared.length === 1 ? 'has' : 'have'} no recorded licence. Open the Sound step to add them anyway.`,
    { duration: 10000 },
  );
}

export interface AmbientSoundStepProps {
  project: AmbientProject;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  refresh: () => void;
}

/**
 * Bed mode, track list (via MusicPicker in multi-track mode), volume and
 * crossfade, plus the licence gate: PATCH /:id/bed returns 409 with an
 * `uncleared` list when the bed includes an unknown-licence track, and the
 * operator can always proceed by resending with `allowUncleared: true`.
 */
export function AmbientSoundStep({ project, busy, setBusy, refresh }: AmbientSoundStepProps) {
  const { bed } = project;
  const [uncleared, setUncleared] = useState<UnclearedTrack[] | null>(null);
  const [pendingPatch, setPendingPatch] = useState<AmbientBedPatch | null>(null);

  const applyBedPatch = async (patch: AmbientBedPatch) => {
    setBusy(true);
    try {
      const result = await ambientApi.setBed(project.projectId, patch);
      if (!result.ok) {
        // Not a failure: the operator can still proceed. Keep the patch that
        // triggered it so "use anyway" can resend it unchanged plus the flag.
        setUncleared(result.uncleared);
        setPendingPatch(patch);
        return;
      }
      setUncleared(null);
      setPendingPatch(null);
      refresh();
    } catch (e) {
      toast.error((e as Error).message || 'Failed to update the music bed');
    } finally {
      setBusy(false);
    }
  };

  const useAnyway = () => {
    if (!pendingPatch) return;
    applyBedPatch({ ...pendingPatch, allowUncleared: true });
  };

  const onAssembleChange = (next: MusicValue) => {
    applyBedPatch({ trackRefs: next.paths ?? (next.path ? [next.path] : []), volume: next.volume });
  };

  const onFileChange = (next: MusicValue) => {
    applyBedPatch({ filePath: next.path, volume: next.volume });
  };

  const onImported = async (refs: string[]) => {
    const added = await addImportedToBed(project.projectId, refs);
    if (added && !added.result.ok) {
      // Same licence gate as picking them by hand.
      reportImportGate(added.result.uncleared);
      setUncleared(added.result.uncleared);
      setPendingPatch(added.patch);
      return;
    }
    refresh();
  };

  const assembleValue: MusicValue = { path: bed.trackRefs[0] ?? null, paths: bed.trackRefs, volume: bed.volume };
  const fileValue: MusicValue = { path: bed.filePath, volume: bed.volume };
  const barLabel = 'text-[10px] font-semibold uppercase tracking-[0.1em] text-bf-faint';

  // Bed source, order and crossfade: one bar above the tracklist rather than
  // a column of boxes, so the music itself gets the page.
  const toolbar = (
    <>
      <div className="flex items-center gap-2">
        <span className={barLabel}>Music bed</span>
        <div className={segmentedCls} role="tablist" aria-label="Bed mode">
          <button type="button" onClick={() => applyBedPatch({ mode: 'assemble' })} className={segmentCls(bed.mode === 'assemble')} disabled={busy}>
            Assemble from tracks
          </button>
          <button type="button" onClick={() => applyBedPatch({ mode: 'file' })} className={segmentCls(bed.mode === 'file')} disabled={busy}>
            Upload one mix
          </button>
        </div>
      </div>
      {bed.mode === 'assemble' && (
        <div className="flex items-center gap-2">
          <span className={barLabel}>Order</span>
          <div className={segmentedCls} role="tablist" aria-label="Track order">
            <button type="button" onClick={() => applyBedPatch({ order: 'shuffle' })} className={segmentCls((bed.order ?? 'shuffle') === 'shuffle')} disabled={busy}>Shuffle</button>
            <button type="button" onClick={() => applyBedPatch({ order: 'fixed' })} className={segmentCls(bed.order === 'fixed')} disabled={busy}>Keep my order</button>
          </div>
        </div>
      )}
      {bed.mode === 'assemble' && (
        <label className="flex items-center gap-2 text-bf-sub">
          <span className={barLabel}>Crossfade</span>
          <input
            type="number"
            min={0}
            max={30}
            step={1}
            aria-label="Crossfade (seconds)"
            value={bed.crossfadeSec}
            disabled={busy}
            onChange={(e) => applyBedPatch({ crossfadeSec: Number(e.target.value) })}
            className="w-14 rounded-md border border-[rgba(216,184,120,0.25)] bg-transparent px-2 py-0.5 text-right font-mono text-bf-cream"
          />
          <span>s</span>
        </label>
      )}
    </>
  );

  return (
    <div className="space-y-4">
      {uncleared && uncleared.length > 0 && (
        <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-600">
          <div className="font-medium">
            {uncleared.length === 1 ? 'This track has' : `${uncleared.length} tracks have`} an unrecorded licence.
          </div>
          <p className="opacity-80">
            On a long music-led video a Content ID claim takes the revenue for the whole video, not a segment.
          </p>
          <ul className="list-disc pl-5">
            {uncleared.map((t) => <li key={t.id}>{t.label}</li>)}
          </ul>
          <button
            type="button"
            onClick={useAnyway}
            disabled={busy}
            className="rounded-md border border-amber-500/50 px-2.5 py-1 text-xs font-semibold hover:bg-amber-500/20"
          >
            Use anyway
          </button>
        </div>
      )}

      {bed.mode === 'assemble' ? (
        <MusicPicker
          value={assembleValue}
          onChange={onAssembleChange}
          busy={busy}
          multiple
          variant="full"
          reorderable={bed.order === 'fixed'}
          targetSec={project.targetSec}
          crossfadeSec={bed.crossfadeSec}
          toolbar={toolbar}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-[rgba(216,184,120,0.18)] bg-bf-card px-3 py-2 text-xs">
            {toolbar}
          </div>
          <div className={panelCls}>
            <MusicPicker value={fileValue} onChange={onFileChange} busy={busy} />
          </div>
        </>
      )}

      <MusicLibraryImport busy={busy} onAdded={bed.mode === 'assemble' ? onImported : undefined} />
    </div>
  );
}
