import { useRef, useState, type SyntheticEvent } from 'react';
import { Check } from 'lucide-react';
import { momentsApi } from '../../lib/momentsApi';
import { toastError } from '../../lib/errors';
import type { MomentPatch, MomentMeta } from '../../lib/momentsTypes';
import type { MomentStepProps } from '../../pages/MomentsPage';
import { fieldLabelCls, panelCls, segmentCls, segmentedCls } from '../story/formStyles';

type MomentStyleMeta = MomentMeta['styles'][number];

const energyWord = (e: number) => (e < 0.34 ? 'Calm' : e <= 0.66 ? 'Lively' : 'Hype');

export function MomentsStyleStep({ project, meta, refresh, busy, setBusy, commit }: MomentStepProps) {
  // The slider owns its value while this step is mounted: a refetch must never move it under the user's hand.
  const [energy, setEnergy] = useState(Math.round(project.energy * 100));
  /** The last value saved (or being saved), so release + blur + key-up on one change save once. */
  const savedEnergy = useRef(Math.round(project.energy * 100));
  /** The slider's own save is running: it stays enabled so keyboard focus is not lost on every arrow press. */
  const [savingEnergy, setSavingEnergy] = useState(false);
  /** The Energy the server last accepted: where a failed save rolls the slider back to. */
  const confirmedEnergy = useRef(Math.round(project.energy * 100));
  /** Energy saves run one after another, and only the newest one settles the slider. */
  const energyChain = useRef<Promise<void>>(Promise.resolve());
  const energyTicket = useRef(0);
  const energyPending = useRef(0);

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

  /**
   * A style brings its natural Energy with it; picking the current one keeps a fine-tuned slider.
   * Meta cached from before styles carried an Energy saves just the style.
   */
  const pickStyle = async (style: MomentStyleMeta) => {
    if (style.id === project.style) return;
    if (!Number.isFinite(style.energy)) {
      await save({ style: style.id });
      return;
    }
    if (await save({ style: style.id, energy: style.energy })) {
      savedEnergy.current = Math.round(style.energy * 100);
      confirmedEnergy.current = savedEnergy.current;
      setEnergy(savedEnergy.current);
    }
  };

  const commitEnergy = (e: SyntheticEvent<HTMLInputElement>) => {
    const value = Number(e.currentTarget.value);
    if (value === savedEnergy.current) return;
    savedEnergy.current = value;
    const ticket = ++energyTicket.current;
    setSavingEnergy(true);
    const run = async () => {
      const ok = await save({ energy: value / 100 });
      if (ok) confirmedEnergy.current = value;
      if (ticket !== energyTicket.current) return; // a newer change is queued and decides the screen
      if (!ok) {
        // Back to what the server last accepted, so the screen matches it.
        savedEnergy.current = confirmedEnergy.current;
        setEnergy(confirmedEnergy.current);
      }
      setSavingEnergy(false);
    };
    // The slider stays usable while it saves, so a change made meanwhile queues behind it:
    // saves reach the server in order. With nothing pending, the save goes out at once.
    const idle = energyPending.current === 0;
    energyPending.current += 1;
    energyChain.current = (idle ? run() : energyChain.current.then(run))
      .finally(() => { energyPending.current -= 1; });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {meta.styles.map((s) => {
          const picked = project.style === s.id;
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={picked}
              disabled={busy}
              onClick={() => { void pickStyle(s); }}
              // An outline, not a ring: the glass card's own box-shadow would paint over a ring.
              // Keyboard focus thickens it in the text colour, so a focused picked card still shows focus.
              className={`glass relative overflow-hidden rounded-bf text-left disabled:opacity-60 ${picked ? 'outline outline-2 outline-offset-2 outline-bf-gold focus-visible:outline-4 focus-visible:outline-bf-cream' : ''}`}
            >
              {/* The first-frame fragment keeps the card from staying blank where iOS will not autoplay (Low Power Mode). */}
              <video src={`/moments/previews/${s.id}.mp4#t=0.001`} autoPlay muted loop playsInline preload="metadata" aria-hidden="true" className="aspect-[9/16] w-full object-cover" />
              {picked && (
                // Visual only: aria-pressed already tells assistive tech which style is picked.
                <span aria-hidden="true" className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-bf-gold px-2 py-0.5 text-xs font-semibold text-bf-bg shadow">
                  <Check className="h-3 w-3" aria-hidden="true" />
                  Selected
                </span>
              )}
              <div className="p-2">
                <div className="text-sm font-semibold text-bf-cream">{s.label}</div>
                <div className="text-help">{s.description}</div>
              </div>
            </button>
          );
        })}
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
