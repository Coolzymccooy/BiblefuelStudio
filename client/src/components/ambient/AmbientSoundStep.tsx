import { useState } from 'react';
import toast from 'react-hot-toast';
import { ambientApi, type AmbientBedPatch, type UnclearedTrack } from '../../lib/ambientApi';
import type { AmbientProject } from '../../lib/ambientTypes';
import { MusicPicker, type MusicValue } from '../MusicPicker';
import { MusicLibraryImport } from '../MusicLibraryImport';
import { fieldLabelCls, panelCls, segmentCls, segmentedCls } from '../story/formStyles';

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

  return (
    <div className="space-y-4">
      <div>
        <div className={fieldLabelCls}>Music bed</div>
        <div className={segmentedCls} role="tablist" aria-label="Bed mode">
          <button
            type="button"
            onClick={() => applyBedPatch({ mode: 'assemble' })}
            className={segmentCls(bed.mode === 'assemble')}
            disabled={busy}
          >
            Assemble from tracks
          </button>
          <button
            type="button"
            onClick={() => applyBedPatch({ mode: 'file' })}
            className={segmentCls(bed.mode === 'file')}
            disabled={busy}
          >
            Upload one mix
          </button>
        </div>
      </div>

      {uncleared && uncleared.length > 0 && (
        <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-200">
          <div className="font-medium">
            {uncleared.length === 1 ? 'This track has' : `${uncleared.length} tracks have`} an unrecorded licence.
          </div>
          <p className="text-amber-200/80">
            On a long music-led video a Content ID claim takes the revenue for the whole video, not a segment.
          </p>
          <ul className="list-disc pl-5 text-amber-200/90">
            {uncleared.map((t) => <li key={t.id}>{t.label}</li>)}
          </ul>
          <button
            type="button"
            onClick={useAnyway}
            disabled={busy}
            className="rounded-md border border-amber-400/50 px-2.5 py-1 text-xs font-semibold hover:bg-amber-500/20"
          >
            Use anyway
          </button>
        </div>
      )}

      {bed.mode === 'assemble' && (
        <div>
          <div className={fieldLabelCls}>Track order</div>
          <div className={segmentedCls} role="tablist" aria-label="Track order">
            <button type="button" onClick={() => applyBedPatch({ order: 'shuffle' })} className={segmentCls((bed.order ?? 'shuffle') === 'shuffle')} disabled={busy}>Shuffle</button>
            <button type="button" onClick={() => applyBedPatch({ order: 'fixed' })} className={segmentCls(bed.order === 'fixed')} disabled={busy}>Keep my order</button>
          </div>
        </div>
      )}

      {bed.mode === 'assemble' ? (
        <MusicPicker value={assembleValue} onChange={onAssembleChange} busy={busy} multiple reorderable={bed.order === 'fixed'} />
      ) : (
        <MusicPicker value={fileValue} onChange={onFileChange} busy={busy} />
      )}

      <MusicLibraryImport busy={busy} onAdded={bed.mode === 'assemble' ? onImported : undefined} />

      <div className={`${panelCls} space-y-3`}>
        <label className="flex items-center justify-between gap-3 text-sm text-content-secondary">
          Crossfade (seconds)
          <input
            type="number"
            min={0}
            max={30}
            step={1}
            value={bed.crossfadeSec}
            disabled={busy || bed.mode !== 'assemble'}
            onChange={(e) => applyBedPatch({ crossfadeSec: Number(e.target.value) })}
            className="w-20 rounded-md border border-white/10 bg-transparent px-2 py-1 text-right text-white"
          />
        </label>
      </div>
    </div>
  );
}
