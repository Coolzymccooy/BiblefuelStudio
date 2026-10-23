import { useEffect, useState } from 'react';
import { Field } from '../ui/Field';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { fetchMusicLibrary, type MusicTrack } from '../../lib/musicLibraryApi';
import type { SceneScriptProject } from '../../lib/sceneScriptTypes';
import type { ProjectEdit } from '../../lib/sceneScriptApi';
import { clock } from './format';

interface Props {
  project: SceneScriptProject;
  onEdit: (edit: ProjectEdit) => Promise<void>;
}

/** One music bed per cue, from the bundled library or the operator's own uploads. */
export function MusicPanel({ project, onEdit }: Props) {
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  useEffect(() => { fetchMusicLibrary().then(setTracks).catch(() => setTracks([])); }, []);
  const sceneNumbers = (ids: string[]) => ids.map((id) => project.scenes.find((s) => s.id === id)?.number).filter(Boolean).join(', ');

  return (
    <ul className="space-y-3">
      {project.music.cues.map((cue) => (
        <li key={cue.id} className="rounded-card border border-editor-line bg-bf-card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-bf-cream">{cue.mood || 'Music'}</h3>
            <span className="text-xs tabular-nums text-bf-muted">
              Scenes {sceneNumbers(cue.sceneIds)}{cue.from !== null ? ` · script ${clock(cue.from)}–${clock(cue.to)}` : ''}
            </span>
          </div>
          {cue.notes && <p className="mt-1 text-help">{cue.notes}</p>}
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_8rem]">
            <Field label={cue.bedSuggested ? 'Bed (suggested)' : 'Bed'} htmlFor={`bed-${cue.id}`}>
              <Select id={`bed-${cue.id}`} value={cue.bed || ''} onChange={(e) => onEdit({ cues: [{ id: cue.id, bed: e.target.value }] })}>
                {!tracks.some((t) => t.ref === cue.bed) && cue.bed && <option value={cue.bed}>{cue.bed}</option>}
                {tracks.filter((t) => !/\(vocal\)/.test(t.label)).map((t) => <option key={t.ref} value={t.ref}>{t.label}{t.source === 'upload' ? ' (yours)' : ''}</option>)}
              </Select>
            </Field>
            <Field label="Start at (s)" htmlFor={`bed-offset-${cue.id}`}>
              <Input
                id={`bed-offset-${cue.id}`} type="number" min="0" step="1" defaultValue={cue.offsetSec}
                onBlur={(e) => { const v = Number(e.target.value) || 0; if (v !== cue.offsetSec) void onEdit({ cues: [{ id: cue.id, offsetSec: v }] }); }}
                className="tabular-nums"
              />
            </Field>
          </div>
          {cue.sfx.includes('heartbeat') && <p className="mt-2 text-xs text-bf-muted">A soft heartbeat plays under this cue.</p>}
        </li>
      ))}
      {project.music.drops.length > 0 && (
        <li className="text-help">The music drops out before “{project.music.drops[0].phrase}”, then lands with an impact.</li>
      )}
    </ul>
  );
}
