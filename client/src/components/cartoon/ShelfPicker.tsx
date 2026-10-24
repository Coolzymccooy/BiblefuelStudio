/**
 * "Add from shelf": characters approved in earlier cartoons, pulled into this
 * one with their look, voice and portrait already approved, so a recurring
 * character keeps the same face across a series. Each saved character is put
 * in place of one of this script's characters (the same name by default);
 * replacing a character who already has a portrait asks first.
 */
import { useEffect, useState } from 'react';
import { Library, Trash2 } from 'lucide-react';
import { cartoonApi } from '../../lib/cartoonApi';
import type { CartoonProject, ShelfCharacter } from '../../lib/cartoonTypes';
import { toastError } from '../../lib/errors';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { waitingCast } from './cast';

interface Props {
  project: CartoonProject;
  onSaved: (project: CartoonProject) => void;
}

/** The cast member a shelf character goes to unless the admin picks another. */
function defaultTarget(project: CartoonProject, character: ShelfCharacter): string {
  const names = Object.keys(project.cast);
  if (names.includes(character.name)) return character.name;
  return waitingCast(project).find((n) => names.includes(n)) ?? names[0] ?? character.name;
}

function ShelfRow({ project, character, onSaved, onRemoved }: Props & { character: ShelfCharacter; onRemoved: (id: string) => void }) {
  const [target, setTarget] = useState(() => defaultTarget(project, character));
  const [busy, setBusy] = useState(false);
  const names = Object.keys(project.cast);
  const otherStyle = character.style !== null && character.style !== project.meta.style;
  const selectId = `shelf-${character.id}-for`;

  const use = async () => {
    const replacing = project.cast[target]?.portrait;
    if (replacing && !window.confirm(`Replace ${target}'s look, voice and portrait with the saved ${character.name}?`)) return;
    setBusy(true);
    try {
      onSaved(await cartoonApi.fromShelf(project.id, character.id, target === character.name ? undefined : target));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Remove ${character.name} from the shelf? Cartoons that already use them keep their portrait.`)) return;
    try {
      await cartoonApi.removeFromShelf(character.id);
      onRemoved(character.id);
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <li className="flex items-center gap-3 rounded-lg border border-editor-line bg-bf-card2 p-3">
      <img src={character.portraitUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-semibold text-bf-cream">{character.name}</span>
          {otherStyle && <span className="text-xs text-bf-warn">Another style</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={selectId} className="text-xs text-bf-sub">As</label>
          <Select id={selectId} aria-label={`Use ${character.name} as`} value={target} onChange={(e) => setTarget(e.target.value)} className="!w-auto !py-1 text-sm">
            {names.map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
          <Button variant="secondary" className="!px-3 !py-1 text-sm" aria-label={`Use ${character.name}`} isLoading={busy} disabled={project.running.pictures} onClick={use}>
            Use
          </Button>
        </div>
      </div>
      <button
        type="button"
        aria-label={`Remove ${character.name} from the shelf`}
        title="Remove from the shelf"
        onClick={remove}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-bf-sub hover:text-bf-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-bf-gold"
      >
        <Trash2 size={14} aria-hidden="true" />
      </button>
    </li>
  );
}

export function ShelfPicker({ project, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [shelf, setShelf] = useState<ShelfCharacter[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    setError(null);
    cartoonApi.shelf().then(
      (rows) => { if (live) setShelf(rows); },
      (e: unknown) => { if (live) setError(e instanceof Error ? e.message : 'Could not load the character shelf.'); },
    );
    return () => { live = false; };
  }, [open]);

  return (
    <section aria-label="Character shelf" className="space-y-3">
      <Button variant="secondary" aria-expanded={open} aria-controls="cartoon-shelf" onClick={() => setOpen((v) => !v)}>
        <Library size={16} aria-hidden="true" /> Add from shelf
      </Button>
      {open && (
        <div id="cartoon-shelf" className="space-y-3 rounded-card border border-editor-line bg-bf-card p-4">
          <p className="text-help">Characters you saved from earlier cartoons. They arrive approved, with the same face.</p>
          {error && <p role="alert" className="text-sm text-bf-danger">{error}</p>}
          {!error && shelf === null && <p className="text-help">Loading the shelf…</p>}
          {shelf?.length === 0 && (
            <p className="text-help">Nothing on the shelf yet. Approve a character, then choose Save to shelf to reuse them later.</p>
          )}
          {shelf && shelf.length > 0 && (
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {shelf.map((c) => (
                <ShelfRow
                  key={c.id}
                  project={project}
                  character={c}
                  onSaved={onSaved}
                  onRemoved={(id) => setShelf((rows) => (rows ?? []).filter((r) => r.id !== id))}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
