/**
 * One row of the shot list: who speaks and what they say, how long the shot
 * runs and what it costs, the director's note (saved when it loses focus and
 * only when changed), and whether the shot is a new angle or continues from
 * the last frame of the shot before. A new-angle shot shows the approved
 * portraits it will be sent with; the film's first shot can only be a new
 * angle, because nothing comes before it.
 */
import { useEffect, useState } from 'react';
import type { CartoonFirstFrame, CartoonProject, CartoonShot } from '../../lib/cartoonTypes';
import { toastError } from '../../lib/errors';
import { cartoonApi } from '../../lib/cartoonApi';
import { Input } from '../ui/Input';
import { money } from '../sceneScript/format';
import { listNames } from './cast';
import { MAX_NOTE_CHARS, asOrdered, canChain, referencedCast, shotPriceUsd } from './shotList';

interface Props {
  project: CartoonProject;
  shot: CartoonShot;
  index: number;
  disabled: boolean;
  onSaved: (project: CartoonProject) => void;
  /** Told when a save of this row starts and ends, so approval can wait for it. */
  onSavingChange?: (shotId: string, saving: boolean) => void;
}

const FIRST_FRAMES: { id: CartoonFirstFrame; label: string }[] = [
  { id: 'fresh', label: 'New angle' },
  { id: 'chain', label: 'Continue from last shot' },
];

const secs = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function References({ project, names }: { project: CartoonProject; names: string[] }) {
  if (!names.length) return <p className="text-help">No approved portraits in this shot yet.</p>;
  return (
    <div className="flex items-center gap-2">
      <div className="flex -space-x-2">
        {names.filter((name) => project.cast[name]?.portrait?.url).map((name) => (
          <img
            key={name}
            src={project.cast[name]?.portrait?.url ?? undefined}
            alt={name}
            title={name}
            className="h-7 w-7 rounded-full border-2 border-bf-card object-cover"
          />
        ))}
      </div>
      <span className="text-help">Uses the portrait{names.length === 1 ? '' : 's'} of {listNames(names)}</span>
    </div>
  );
}

export function ShotRow({ project, shot, index, disabled, onSaved, onSavingChange }: Props) {
  const [note, setNote] = useState(shot.note);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setNote(shot.note); }, [shot.note]);

  const n = index + 1;
  const ordered = asOrdered(shot, index);
  const scene = project.scenes.find((s) => s.id === shot.sceneId);
  const price = shotPriceUsd(project.estimate, shot);
  const references = referencedCast(project, ordered);
  const noteId = `shot-${shot.id}-note`;
  const whyId = `shot-${shot.id}-why`;

  const patch = async (edit: { note?: string; firstFrame?: CartoonFirstFrame }) => {
    setSaving(true);
    onSavingChange?.(shot.id, true);
    try {
      onSaved(await cartoonApi.update(project.id, { shots: [{ id: shot.id, ...edit }] }));
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
      onSavingChange?.(shot.id, false);
    }
  };

  const saveNote = () => {
    const text = note.trim();
    if (text !== shot.note.trim()) void patch({ note: text });
  };

  return (
    <li aria-label={`Shot ${n}`} className="rounded-card border border-editor-line bg-bf-card p-4">
      <div className="flex items-start gap-4">
        <span className="w-5 shrink-0 pt-0.5 text-sm font-semibold tabular-nums text-bf-gold" aria-hidden="true">{n}</span>
        <div className="min-w-0 flex-1 space-y-1">
          {scene?.place && <p className="text-xs text-bf-muted">{scene.place}</p>}
          {shot.speaker && shot.line ? (
            <>
              <p className="text-sm font-semibold text-bf-cream">{shot.speaker}</p>
              <p className="text-sm text-bf-cream">“{shot.line}”</p>
            </>
          ) : (
            <p className="text-sm text-bf-sub">No one speaks</p>
          )}
          {shot.action && <p className="text-sm text-bf-sub">{shot.action}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5 text-sm tabular-nums">
          <span className="text-bf-cream">{secs(shot.seconds)} s</span>
          {price !== null && <span className="text-bf-sub">about {money(price)}</span>}
        </div>
      </div>
      <div className="mt-4 grid gap-4 sm:pl-9 md:grid-cols-2">
        <div>
          <label htmlFor={noteId} className="field-label">Director's note</label>
          <Input
            id={noteId}
            aria-label={`Director's note for shot ${n}`}
            value={note}
            maxLength={MAX_NOTE_CHARS}
            disabled={disabled}
            placeholder="Close-up, wide, slow push-in…"
            onChange={(e) => setNote(e.target.value)}
            onBlur={saveNote}
            className="text-sm"
          />
        </div>
        <fieldset className="space-y-2" disabled={disabled || saving}>
          <legend className="field-label">First frame</legend>
          <div className="inline-flex flex-wrap rounded-lg border border-editor-line bg-bf-input p-0.5">
            {FIRST_FRAMES.map((opt) => {
              const off = opt.id === 'chain' && !canChain(index);
              const checked = ordered.firstFrame === opt.id;
              return (
                <label
                  key={opt.id}
                  className={`rounded-md px-3 py-1.5 text-sm transition-colors duration-150 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-bf-gold ${checked ? 'bg-editor-panel font-medium text-bf-cream' : 'text-bf-sub'} ${off ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:text-bf-cream'}`}
                >
                  <input
                    type="radio"
                    name={`first-frame-${shot.id}`}
                    value={opt.id}
                    checked={checked}
                    disabled={off}
                    aria-describedby={off ? whyId : undefined}
                    onChange={() => { if (!checked) void patch({ firstFrame: opt.id }); }}
                    className="sr-only"
                  />
                  {opt.label}
                </label>
              );
            })}
          </div>
          {!canChain(index) && <p id={whyId} className="text-help">The first shot has no shot before it to continue.</p>}
          {ordered.firstFrame === 'fresh'
            ? <References project={project} names={references} />
            : <p className="text-help">Starts from the last frame of shot {index}</p>}
        </fieldset>
      </div>
    </li>
  );
}
