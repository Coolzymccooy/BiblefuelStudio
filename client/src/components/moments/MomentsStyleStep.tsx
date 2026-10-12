import { useRef, useState, type SyntheticEvent } from 'react';
import { momentsApi } from '../../lib/momentsApi';
import { toastError } from '../../lib/errors';
import type { MomentPatch } from '../../lib/momentsTypes';
import type { MomentStepProps } from '../../pages/MomentsPage';
import { fieldLabelCls, panelCls, segmentCls, segmentedCls } from '../story/formStyles';

const energyWord = (e: number) => (e < 0.34 ? 'Calm' : e <= 0.66 ? 'Lively' : 'Hype');

export function MomentsStyleStep({ project, meta, refresh, busy, setBusy, commit }: MomentStepProps) {
  // The slider owns its value while this step is mounted: a refetch must never move it under the user's hand.
  const [energy, setEnergy] = useState(Math.round(project.energy * 100));
  /** The last value saved (or being saved), so release + blur + key-up on one change save once. */
  const savedEnergy = useRef(Math.round(project.energy * 100));
  /** The slider's own save is running: it stays enabled so keyboard focus is not lost on every arrow press. */
  const [savingEnergy, setSavingEnergy] = useState(false);

  const save = async (patch: MomentPatch): Promise<boolean> => {
    setBusy(true);
    try {
      commit(await momentsApi.update(project.projectId, patch));
      refresh();
      return true;
    } catch (e) {
      toastError(e);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const commitEnergy = async (e: SyntheticEvent<HTMLInputElement>) => {
    const value = Number(e.currentTarget.value);
    if (value === savedEnergy.current) return;
    const previous = savedEnergy.current;
    savedEnergy.current = value;
    setSavingEnergy(true);
    const ok = await save({ energy: value / 100 });
    if (!ok) {
      // Roll the slider back so the screen matches what the server has.
      savedEnergy.current = previous;
      setEnergy(previous);
    }
    setSavingEnergy(false);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {meta.styles.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={project.style === s.id}
            disabled={busy}
            onClick={() => save({ style: s.id })}
            className={`glass overflow-hidden rounded-bf text-left disabled:opacity-60 ${project.style === s.id ? 'ring-2 ring-bf-gold' : ''}`}
          >
            <video src={`/moments/previews/${s.id}.mp4`} autoPlay muted loop playsInline preload="metadata" aria-hidden="true" className="aspect-[9/16] w-full object-cover" />
            <div className="p-2">
              <div className="text-sm font-semibold text-bf-cream">{s.label}</div>
              <div className="text-help">{s.description}</div>
            </div>
          </button>
        ))}
      </div>
      <div className={panelCls}>
        <label className={fieldLabelCls}>
          Energy: {energyWord(energy / 100)}
          <input
            type="range"
            min={0}
            max={100}
            value={energy}
            disabled={busy && !savingEnergy}
            onChange={(e) => setEnergy(Number(e.target.value))}
            onMouseUp={commitEnergy}
            onTouchEnd={commitEnergy}
            onKeyUp={commitEnergy}
            onBlur={commitEnergy}
            className="w-full"
          />
        </label>
        <div className="mt-1 flex justify-between text-help"><span>Calm</span><span>Hype</span></div>
      </div>
      <div>
        <div className={fieldLabelCls}>Length</div>
        <div className={segmentedCls} role="group" aria-label="Length">
          {meta.lengths.map((l) => (
            <button key={l} type="button" aria-pressed={project.lengthSec === l} disabled={busy} onClick={() => save({ lengthSec: l })} className={segmentCls(project.lengthSec === l)}>
              {l} s
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
