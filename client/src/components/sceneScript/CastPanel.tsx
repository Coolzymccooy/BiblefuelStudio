import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Textarea } from '../ui/Textarea';
import type { CastEntry, EnsembleLayer, SceneScriptProject, VoiceOption } from '../../lib/sceneScriptTypes';
import type { ProjectEdit } from '../../lib/sceneScriptApi';

interface Props {
  project: SceneScriptProject;
  voices: VoiceOption[];
  rooms: string[];
  onEdit: (edit: ProjectEdit) => Promise<void>;
}

const RATES = ['-20%', '-15%', '-12%', '-10%', '-8%', '-6%', '-4%', '0%', '+5%', '+10%'];
const PITCHES = ['-6%', '-4%', '-2%', '0%', '+2%', '+4%', '+6%'];

function VoiceSelect({ id, value, voices, label, onChange }: { id?: string; value?: string; voices: VoiceOption[]; label: string; onChange: (v: string) => void }) {
  return (
    <Select id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
    </Select>
  );
}

function Ensemble({ entry, voices, rooms, onChange }: { entry: CastEntry; voices: VoiceOption[]; rooms: string[]; onChange: (e: CastEntry) => void }) {
  const layers = entry.ensemble || [];
  const setLayer = (i: number, patch: Partial<EnsembleLayer>) => onChange({ ...entry, ensemble: layers.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Room" htmlFor="ensemble-room">
          <Select id="ensemble-room" value={entry.room} onChange={(e) => onChange({ ...entry, room: e.target.value })}>
            {rooms.map((r) => <option key={r} value={r}>{r === 'small' ? 'Small room' : r === 'hall' ? 'Hall' : 'Church'}</option>)}
          </Select>
        </Field>
        <Field label="Pace" htmlFor="ensemble-rate">
          <Select id="ensemble-rate" value={entry.rate} onChange={(e) => onChange({ ...entry, rate: e.target.value })}>
            {RATES.map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
        </Field>
      </div>
      <div className="hidden items-center gap-2 text-xs text-bf-muted sm:flex" aria-hidden="true">
        <span className="flex-1 basis-56">Voice</span>
        <span className="w-24">Pitch</span>
        <span className="w-24">Delay (ms)</span>
        <span className="w-9" />
      </div>
      <ul className="space-y-2">
        {layers.map((l, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1 basis-56">
              <VoiceSelect value={l.voice} voices={voices} label={`Ensemble voice ${i + 1}`} onChange={(v) => setLayer(i, { voice: v })} />
            </div>
            <Select aria-label={`Ensemble voice ${i + 1} pitch`} value={l.pitch} onChange={(e) => setLayer(i, { pitch: e.target.value })} className="!w-24">
              {PITCHES.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
            <Input
              type="number" min="0" max="400" step="5" aria-label={`Ensemble voice ${i + 1} delay in milliseconds`} title="Delay in milliseconds"
              value={l.offsetMs} onChange={(e) => setLayer(i, { offsetMs: Number(e.target.value) || 0 })} className="!w-24 tabular-nums"
            />
            <button
              type="button" aria-label={`Remove ensemble voice ${i + 1}`} disabled={layers.length <= 1}
              onClick={() => onChange({ ...entry, ensemble: layers.filter((_, j) => j !== i) })}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-editor-line text-bf-sub hover:text-bf-danger disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-bf-gold"
            >
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <Button
        variant="ghost" disabled={layers.length >= 12}
        onClick={() => onChange({ ...entry, ensemble: [...layers, { voice: voices[0]?.id || '', pitch: '0%', offsetMs: 30 * layers.length }] })}
      >
        <Plus size={16} aria-hidden="true" /> Add a voice
      </Button>
    </div>
  );
}

/** Who reads what: a voice per speaker, the ensemble stack, and the main character's look. */
export function CastPanel({ project, voices, rooms, onEdit }: Props) {
  const [cast, setCast] = useState(project.cast);
  const [look, setLook] = useState(project.look);
  useEffect(() => { setCast(project.cast); setLook(project.look); }, [project.cast, project.look]);
  const dirty = JSON.stringify(cast) !== JSON.stringify(project.cast) || JSON.stringify(look) !== JSON.stringify(project.look);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {Object.entries(cast).filter(([, e]) => !e.ensemble).map(([name, entry]) => (
          <div key={name} className="space-y-2">
            <Field label={name} htmlFor={`cast-${name}`}>
              <VoiceSelect id={`cast-${name}`} value={entry.voice} voices={voices} label={`${name} voice`} onChange={(v) => setCast({ ...cast, [name]: { ...entry, voice: v } })} />
            </Field>
            <div className="flex gap-2">
              <Select aria-label={`${name} pace`} value={entry.rate} onChange={(e) => setCast({ ...cast, [name]: { ...entry, rate: e.target.value } })}>
                {RATES.map((r) => <option key={r} value={r}>Pace {r}</option>)}
              </Select>
              <Select aria-label={`${name} pitch`} value={entry.pitch} onChange={(e) => setCast({ ...cast, [name]: { ...entry, pitch: e.target.value } })}>
                {PITCHES.map((p) => <option key={p} value={p}>Pitch {p}</option>)}
              </Select>
            </div>
          </div>
        ))}
      </div>
      {Object.entries(cast).filter(([, e]) => e.ensemble).map(([name, entry]) => (
        <div key={name}>
          <div className="section-title">{name}</div>
          <p className="text-help mb-2">These voices read each chant together, a few milliseconds apart.</p>
          <Ensemble entry={entry} voices={voices} rooms={rooms} onChange={(e) => setCast({ ...cast, [name]: e })} />
        </div>
      ))}
      <Field label="Main character" htmlFor="look-lead" tooltip="Used wherever a visual says 'a man', 'the central character' or 'a figure', so the same person appears in every shot.">
        <Textarea id="look-lead" rows={2} value={look.lead} onChange={(e) => setLook({ ...look, lead: e.target.value })} />
      </Field>
      <Field label="People in other shots" htmlFor="look-people">
        <Input id="look-people" value={look.peopleNote} onChange={(e) => setLook({ ...look, peopleNote: e.target.value })} />
      </Field>
      <Button onClick={() => onEdit({ cast, look })} disabled={!dirty}>Save cast and look</Button>
    </div>
  );
}
