import { useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import { ambientApi } from '../../lib/ambientApi';
import type { AmbientDrop, AmbientProject } from '../../lib/ambientTypes';
import { fieldLabelCls, panelCls, primaryBtnCls, secondaryBtnCls } from '../story/formStyles';

export interface AmbientWordStepProps {
  project: AmbientProject;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  refresh: () => void;
}

const minutesLabel = (atMs: number): string => (atMs / 60000).toFixed(1);
const msFromMinutes = (minutes: string): number => Math.max(0, Math.round(Number(minutes) * 60000));

/**
 * Theme (read-only — set at creation, there is no route to change it after),
 * verse suggestion, an editable drop list (reference + time in minutes), and
 * "Voice all" with per-drop status including any lookup/synthesis error.
 */
export function AmbientWordStep({ project, busy, setBusy, refresh }: AmbientWordStepProps) {
  const [count, setCount] = useState('');
  const musicOnly = project.words === 'none';
  const setMusicOnly = async (next: boolean) => {
    setBusy(true);
    try {
      await ambientApi.setWords(project.projectId, next ? 'none' : 'verses');
      refresh();
    } catch (e) {
      toast.error((e as Error).message || 'Failed to change the words setting');
    } finally {
      setBusy(false);
    }
  };

  const suggestVerses = async () => {
    setBusy(true);
    try {
      const parsed = count.trim() ? Number(count) : undefined;
      await ambientApi.plan(project.projectId, parsed);
      refresh();
      toast.success('Verses suggested');
    } catch (e) {
      toast.error((e as Error).message || 'Failed to suggest verses');
    } finally {
      setBusy(false);
    }
  };

  const voiceAll = async () => {
    setBusy(true);
    try {
      await ambientApi.voiceDrops(project.projectId);
      refresh();
      toast.success('Voicing drops…');
    } catch (e) {
      toast.error((e as Error).message || 'Failed to voice drops');
    } finally {
      setBusy(false);
    }
  };

  // Sends the WHOLE drop list on every edit — the server replaces drops[]
  // wholesale from this patch, so a partial send would drop the others.
  const patchDrop = async (dropId: string, patch: Partial<Pick<AmbientDrop, 'reference' | 'atMs'>>) => {
    const updated = project.drops.map((d) => (d.id === dropId ? { ...d, ...patch } : d));
    try {
      await ambientApi.patchDrops(
        project.projectId,
        updated.map((d) => ({ id: d.id, atMs: d.atMs, reference: d.reference, translation: d.translation })),
      );
      refresh();
    } catch (e) {
      toast.error((e as Error).message || 'Failed to update the drop');
    }
  };

  return (
    <div className="space-y-4">
      <label className={`${panelCls} flex items-center justify-between gap-3 text-sm text-content-secondary`}>
        <span>
          <span className="font-medium text-white">Music only (no verses)</span>
          <span className="block text-xs text-content-secondary">One picture for the whole video and a tracklist in the description.</span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={musicOnly}
          aria-label="Music only"
          disabled={busy}
          onClick={() => setMusicOnly(!musicOnly)}
          className={`h-6 w-11 rounded-full transition ${musicOnly ? 'bg-primary-500' : 'bg-white/15'}`}
        >
          <span className={`block h-5 w-5 rounded-full bg-white transition ${musicOnly ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </label>

      {musicOnly ? (
        <p className="text-sm text-content-secondary">No verses will be spoken. Go on to Look to choose the picture.</p>
      ) : (
        <>
          <label className={fieldLabelCls}>
            Theme
            <div className="input mt-1.5 cursor-not-allowed opacity-70">{project.theme || '—'}</div>
          </label>

          <div className={`${panelCls} flex flex-wrap items-center gap-2`}>
            <input
              type="number"
              min={1}
              placeholder="Count (optional)"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              disabled={busy}
              className="w-32 rounded-md border border-white/10 bg-transparent px-2 py-1 text-white"
              aria-label="Number of verses to suggest"
            />
            <button type="button" onClick={suggestVerses} disabled={busy} className={`${primaryBtnCls} px-3 py-1.5`}>
              Suggest verses
            </button>
            <button
              type="button"
              onClick={voiceAll}
              disabled={busy || project.drops.length === 0}
              className={`${secondaryBtnCls} ml-auto px-3 py-1.5`}
            >
              Voice all
            </button>
          </div>

          <div className="space-y-2">
            {project.drops.length === 0 && (
              <p className="text-sm text-content-tertiary">No drops yet — suggest verses to get started.</p>
            )}
            {project.drops.map((drop) => (
              <DropRow
                key={drop.id}
                drop={drop}
                busy={busy}
                voicing={project.status === 'voicing'}
                onPatch={(patch) => patchDrop(drop.id, patch)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

interface DropRowProps {
  drop: AmbientDrop;
  busy: boolean;
  /** True while the whole project is mid-voicing, so the badge may spin. */
  voicing: boolean;
  onPatch: (patch: Partial<Pick<AmbientDrop, 'reference' | 'atMs'>>) => void;
}

/**
 * Local draft state, committed on blur. A controlled input bound straight to
 * `drop.reference` would snap back mid-edit on every refetch (the server
 * round trip after the PREVIOUS keystroke's patch) — keying on `drop.id`
 * keeps this state across re-renders of the parent while the operator types.
 */
function DropRow({ drop, busy, voicing, onPatch }: DropRowProps) {
  const [reference, setReference] = useState(drop.reference);
  const [minutes, setMinutes] = useState(minutesLabel(drop.atMs));

  const commitReference = () => { if (reference !== drop.reference) onPatch({ reference }); };
  const commitMinutes = () => {
    const atMs = msFromMinutes(minutes);
    if (atMs !== drop.atMs) onPatch({ atMs });
  };

  return (
    <div className={`${panelCls} flex flex-wrap items-center gap-2`}>
      <input
        aria-label={`Reference for drop at ${minutesLabel(drop.atMs)} minutes`}
        value={reference}
        disabled={busy}
        onChange={(e) => setReference(e.target.value)}
        onBlur={commitReference}
        className="min-w-0 flex-1 rounded-md border border-white/10 bg-transparent px-2 py-1 text-white"
      />
      <label className="flex items-center gap-1.5 text-xs text-content-secondary">
        min
        <input
          type="number"
          aria-label={`Minute for ${drop.reference}`}
          min={0}
          step={0.1}
          value={minutes}
          disabled={busy}
          onChange={(e) => setMinutes(e.target.value)}
          onBlur={commitMinutes}
          className="w-20 rounded-md border border-white/10 bg-transparent px-2 py-1 text-right text-white"
        />
      </label>
      <DropStatusBadge drop={drop} voicing={voicing} />
    </div>
  );
}

/**
 * A spinner means "this is happening right now". "Suggest verses" only picks
 * references — the lookup and synthesis happen later, when you press "Voice
 * all" — so a drop sitting there unspoken is WAITING, not working, and
 * spinning at it just reads as a job that never finishes. The spinner is
 * earned only while the project is actually voicing.
 */
function DropStatusBadge({ drop, voicing }: { drop: AmbientDrop; voicing: boolean }) {
  if (drop.status === 'done') {
    return <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-300">Voiced</span>;
  }
  if (drop.status === 'error') {
    return (
      <span className="shrink-0 rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] text-red-300" title={drop.error || 'Voicing failed'}>
        Error{drop.error ? `: ${drop.error}` : ''}
      </span>
    );
  }
  if (voicing) {
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-full bg-[rgba(216,184,120,0.12)] px-2 py-0.5 text-[11px] text-bf-goldDim">
        <Loader2 size={10} className="animate-spin" /> Voicing…
      </span>
    );
  }
  return (
    <span
      className="shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-content-tertiary"
      title="The reference is set. Press “Voice all” to look it up and speak it."
    >
      Not voiced
    </span>
  );
}
