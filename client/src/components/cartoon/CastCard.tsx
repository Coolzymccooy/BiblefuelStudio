/**
 * One character of a cartoon: the portrait on the left, the look and voice on
 * the right, and the actions that move the portrait along (make, make again,
 * approve, save to shelf). Look and voice save when the field loses focus and
 * only when the text changed; the server then drops a portrait whose look
 * changed, so the card shows what the returned project says.
 *
 * Make portrait first waits for any save still in flight and saves a look
 * that has not been saved yet, so the portrait is never drawn from an old look
 * (and the server never sees a cast edit while portraits are being drawn).
 */
import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Check, Loader2, RefreshCw, Sparkles, UserRound } from 'lucide-react';
import { cartoonApi } from '../../lib/cartoonApi';
import type { CartoonCastEntry, CartoonProject } from '../../lib/cartoonTypes';
import { toastError } from '../../lib/errors';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { portraitReady } from './cast';

interface Props {
  project: CartoonProject;
  name: string;
  member: CartoonCastEntry;
  /** Position in the cast, for unique element ids (names may hold spaces). */
  index: number;
  onSaved: (project: CartoonProject) => void;
}

type CastField = 'look' | 'voice';

function Portrait({ name, member }: { name: string; member: CartoonCastEntry }) {
  const portrait = member.portrait;
  const making = portrait?.status === 'making';
  return (
    <div className="relative aspect-square w-32 shrink-0 overflow-hidden rounded-lg border border-editor-line bg-editor-stage sm:w-40">
      {portrait?.url && (
        <img src={portrait.url} alt={`Portrait of ${name}`} className={`h-full w-full object-cover ${making ? 'opacity-40' : ''}`} />
      )}
      {(making || !portrait?.url) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center text-bf-muted" aria-live="polite">
          {making
            ? <Loader2 size={20} className="text-bf-gold motion-safe:animate-spin" aria-hidden="true" />
            : <UserRound size={22} aria-hidden="true" />}
          <span className="text-xs">{making ? 'Drawing the portrait…' : 'No portrait yet'}</span>
        </div>
      )}
    </div>
  );
}

function Status({ member }: { member: CartoonCastEntry }) {
  if (portraitReady(member)) {
    return <span className="inline-flex items-center gap-1 text-xs font-medium text-bf-success"><Check size={14} aria-hidden="true" /> Approved</span>;
  }
  if (member.portrait?.status === 'done') return <span className="text-xs text-bf-sub">Waiting for approval</span>;
  return null;
}

export function CastCard({ project, name, member, index, onSaved }: Props) {
  const [look, setLook] = useState(member.look);
  const [voice, setVoice] = useState(member.voice);
  const [busy, setBusy] = useState<'make' | 'approve' | 'shelve' | null>(null);
  const [shelved, setShelved] = useState(false);
  // The save in flight, if any; saves run one after another.
  const lastSave = useRef<Promise<unknown>>(Promise.resolve());
  // A poll brings a new object with the same values: resync only when the saved text changes.
  useEffect(() => { setLook(member.look); }, [member.look]);
  useEffect(() => { setVoice(member.voice); }, [member.voice]);

  const pictures = project.running.pictures;
  const making = member.portrait?.status === 'making';
  const hasPicture = Boolean(member.portrait?.url);
  const noLook = look.trim() === '';
  const ids = { look: `cast-${index}-look`, voice: `cast-${index}-voice`, why: `cast-${index}-why`, heading: `cast-${index}-name` };

  const save = (field: CastField, value: string): Promise<boolean> => {
    const text = value.trim();
    if (text === (member[field] ?? '').trim()) return Promise.resolve(true);
    const run = lastSave.current.then(async () => {
      try {
        onSaved(await cartoonApi.update(project.id, { cast: { [name]: { [field]: text } } }));
        return true;
      } catch (e) {
        toastError(e);
        return false;
      }
    });
    lastSave.current = run;
    return run;
  };

  const act = async (kind: 'make' | 'approve' | 'shelve', run: () => Promise<void>) => {
    setBusy(kind);
    try {
      await run();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };

  const make = () => act('make', async () => {
    await lastSave.current;
    // Saving the same look twice changes nothing on the server, so a stale comparison here is harmless.
    if (!(await save('look', look))) return;
    onSaved(await cartoonApi.portraits(project.id, [name]));
  });
  const approve = () => act('approve', async () => { onSaved(await cartoonApi.approvePortrait(project.id, name)); });
  const shelve = () => act('shelve', async () => {
    await cartoonApi.shelve(project.id, name);
    setShelved(true);
    toast.success(`${name} is on your shelf for later cartoons.`);
  });

  const onShelf = Boolean(member.shelfId) || shelved;
  const why = noLook ? 'Describe the look first.' : null;

  return (
    <li aria-labelledby={ids.heading} className="flex flex-col gap-4 rounded-card border border-editor-line bg-bf-card p-4 sm:flex-row">
      <Portrait name={name} member={member} />
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 id={ids.heading} className="truncate text-base font-semibold text-bf-cream">{name}</h3>
          <Status member={member} />
        </div>
        <Field label="Look" htmlFor={ids.look}>
          <Textarea
            id={ids.look}
            aria-label={`${name}'s look`}
            rows={3}
            value={look}
            readOnly={pictures}
            placeholder="Age, build, hair, clothes, colours. Repeated in every shot."
            onChange={(e) => setLook(e.target.value)}
            onBlur={() => { void save('look', look); }}
            className="min-h-0 text-sm"
          />
        </Field>
        <Field label="Voice" htmlFor={ids.voice}>
          <Input
            id={ids.voice}
            aria-label={`${name}'s voice`}
            value={voice}
            readOnly={pictures}
            placeholder="For example: deep, slow, kind"
            onChange={(e) => setVoice(e.target.value)}
            onBlur={() => { void save('voice', voice); }}
            className="text-sm"
          />
        </Field>
        {member.portrait?.status === 'error' && member.portrait.error && (
          <p role="alert" className="text-sm text-bf-danger">{member.portrait.error}</p>
        )}
        {member.styleMismatch && portraitReady(member) && (
          <p className="text-sm text-bf-warn">Drawn in another style. Make it again to match this film.</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            className="!px-3 !py-1.5 text-sm"
            aria-label={hasPicture ? `Make ${name}'s portrait again` : `Make portrait of ${name}`}
            aria-describedby={why ? ids.why : undefined}
            isLoading={busy === 'make'}
            disabled={noLook || pictures || making || busy !== null}
            onClick={make}
          >
            {hasPicture ? <RefreshCw size={14} aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}
            {hasPicture ? 'Make again' : 'Make portrait'}
          </Button>
          {member.portrait?.status === 'done' && !member.approved && (
            <Button className="!px-3 !py-1.5 text-sm" aria-label={`Approve ${name}`} isLoading={busy === 'approve'} disabled={busy !== null} onClick={approve}>
              <Check size={14} aria-hidden="true" /> Approve
            </Button>
          )}
          {portraitReady(member) && (onShelf
            ? <span className="inline-flex items-center gap-1 text-xs text-bf-sub"><Check size={14} aria-hidden="true" /> On your shelf</span>
            : (
              <Button variant="ghost" className="!px-3 !py-1.5 text-sm" aria-label={`Save ${name} to shelf`} isLoading={busy === 'shelve'} disabled={busy !== null} onClick={shelve}>
                Save to shelf
              </Button>
            ))}
        </div>
        {why && <p id={ids.why} className="text-help">{why}</p>}
      </div>
    </li>
  );
}
