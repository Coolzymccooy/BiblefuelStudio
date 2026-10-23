import { useState } from 'react';
import { AlertTriangle, Pause, Pencil, Play, RotateCcw } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import type { SceneScriptLine, SceneScriptProject, VoiceOption } from '../../lib/sceneScriptTypes';
import type { ProjectEdit } from '../../lib/sceneScriptApi';
import { clock, kindLabel } from './format';
import { useLinePlayer } from './useLinePlayer';

interface Props {
  project: SceneScriptProject;
  readOnly?: boolean;
  voices?: VoiceOption[];
  onEdit?: (edit: ProjectEdit) => Promise<void>;
}

const iconBtn = 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-editor-line text-bf-sub hover:bg-editor-hover hover:text-bf-cream focus-visible:outline focus-visible:outline-2 focus-visible:outline-bf-gold disabled:opacity-40';

function LineRow({ line, project, readOnly, voices, onEdit, player }: Props & { line: SceneScriptLine; player: ReturnType<typeof useLinePlayer> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(line.text);
  const timed = project.timeline?.lines.find((l) => l.id === line.id);
  const playing = player.playing === line.id;
  const save = async () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== line.text) await onEdit?.({ lines: [{ id: line.id, text: draft.trim() }] });
  };
  return (
    <li className="flex flex-wrap items-start gap-2 py-2 border-t border-editor-line first:border-t-0">
      {!readOnly && (
        <button
          type="button"
          className={iconBtn}
          disabled={!line.audio}
          onClick={() => line.audio && player.toggle(line.id, line.audio.url)}
          aria-label={playing ? `Stop line ${line.id}` : `Play line ${line.id}`}
        >
          {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
        </button>
      )}
      <div className="min-w-0 flex-1 basis-64">
        <div className="flex flex-wrap items-center gap-2 text-xs text-bf-muted">
          <span className="font-medium text-bf-sub">{line.speaker}</span>
          {line.tone && <span>({line.tone})</span>}
          {kindLabel[line.kind] && <Badge>{kindLabel[line.kind]}</Badge>}
          {timed && <span className="tabular-nums">{clock(timed.start)}</span>}
          {line.audioError && <span className="text-bf-danger">{line.audioError}</span>}
        </div>
        {editing ? (
          <Input
            autoFocus
            value={draft}
            aria-label="Line text"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') { setDraft(line.text); setEditing(false); } }}
            className="mt-1"
          />
        ) : (
          <p className={`mt-0.5 text-sm text-bf-cream ${line.emphasis ? 'font-semibold' : ''} ${line.kind === 'scripture' ? 'italic' : ''}`}>{line.text}</p>
        )}
      </div>
      {!readOnly && (
        <div className="flex items-center gap-2">
          <Select
            aria-label={`Voice for line ${line.id}`}
            value={line.voice || ''}
            disabled={line.kind === 'chant'}
            onChange={(e) => onEdit?.({ lines: [{ id: line.id, voice: e.target.value || null }] })}
            className="!w-44 !py-1 text-xs"
          >
            <option value="">{line.kind === 'chant' ? 'Ensemble' : `${line.speaker}'s voice`}</option>
            {voices?.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </Select>
          <Input
            type="number"
            step="0.05"
            min="0"
            max="10"
            aria-label={`Pause after line ${line.id}, seconds`}
            title="Pause after this line, in seconds"
            defaultValue={line.gapAfter ?? timed?.gap ?? ''}
            onBlur={(e) => {
              if (e.target.value === e.target.defaultValue) return;
              const v = e.target.value === '' ? null : Number(e.target.value);
              if (v !== (line.gapAfter ?? null)) void onEdit?.({ lines: [{ id: line.id, gapAfter: v }] });
            }}
            className="!w-20 !py-1 text-xs tabular-nums"
          />
          <span className="-ml-1 text-xs text-bf-muted" aria-hidden="true">s</span>
          <button type="button" className={iconBtn} onClick={() => { setDraft(line.text); setEditing(true); }} aria-label={`Edit line ${line.id}`}>
            <Pencil size={14} aria-hidden="true" />
          </button>
          <button type="button" className={iconBtn} disabled={!line.audio} onClick={() => onEdit?.({ lines: [{ id: line.id, retake: true }] })} aria-label={`Record line ${line.id} again`} title="Record this line again">
            <RotateCcw size={14} aria-hidden="true" />
          </button>
        </div>
      )}
    </li>
  );
}

/** The script as BibleFuel understood it: scenes, visuals, every spoken line and who says it. */
export function ScriptView(props: Props) {
  const { project } = props;
  const player = useLinePlayer();
  return (
    <div className="space-y-4">
      {project.source.warnings.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-editor-line bg-bf-card p-3">
          {project.source.warnings.map((w, i) => (
            <li key={`${w.code}-${i}`} className="flex items-start gap-2 text-sm text-bf-warn">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" /> {w.message}
            </li>
          ))}
        </ul>
      )}
      {project.scenes.map((scene) => {
        const lines = project.lines.filter((l) => l.sceneId === scene.id);
        return (
          <section key={scene.id} aria-label={`Scene ${scene.number}`} className="rounded-card border border-editor-line bg-bf-card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-base font-semibold text-bf-cream">Scene {scene.number} · {scene.title}</h3>
              {scene.targetStart !== null && (
                <span className="text-xs tabular-nums text-bf-muted">Script time {clock(scene.targetStart)}–{clock(scene.targetEnd)}</span>
              )}
            </div>
            {scene.visual && <p className="mt-1 text-help"><span className="font-medium text-bf-sub">Visual:</span> {scene.visual}</p>}
            <ul className="mt-2">
              {lines.map((line) => <LineRow key={line.id} {...props} line={line} player={player} />)}
            </ul>
          </section>
        );
      })}
      {project.source.ignored.length > 0 && (
        <details className="rounded-lg border border-editor-line bg-bf-card p-3">
          <summary className="cursor-pointer text-sm text-bf-sub">Not spoken or used ({project.source.ignored.length} lines)</summary>
          <ul className="mt-2 space-y-1">
            {project.source.ignored.map((x) => (
              <li key={x.lineNo} className="text-xs text-bf-muted">
                <span className="tabular-nums">Line {x.lineNo}</span> · {x.reason} · <span className="text-bf-sub">{x.text.slice(0, 140)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
