import { useState } from 'react';
import { Check, Film, Library, Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Textarea } from '../ui/Textarea';
import type { SceneScriptProject, SceneScriptShot } from '../../lib/sceneScriptTypes';
import type { ProjectEdit } from '../../lib/sceneScriptApi';
import { LibraryPicker } from './LibraryPicker';
import { money } from './format';

interface Props {
  project: SceneScriptProject;
  busy: boolean;
  onEdit: (edit: ProjectEdit) => Promise<void>;
  onReroll: (shotId: string) => Promise<void>;
  onUseLibrary: (shotId: string, clipId: string) => Promise<void>;
}

function ShotCard({ shot, project, busy, onEdit, onReroll, onPickLibrary }: Omit<Props, 'onUseLibrary'> & { shot: SceneScriptShot; onPickLibrary: () => void }) {
  const [prompt, setPrompt] = useState(shot.effectivePrompt);
  const scene = project.scenes.find((s) => s.id === shot.sceneId);
  const clip = shot.clip;
  const working = clip?.status === 'queued' || clip?.status === 'generating';
  const dirty = prompt.trim() !== shot.effectivePrompt;
  return (
    <li className="flex flex-col overflow-hidden rounded-card border border-editor-line bg-bf-card">
      <div className="relative aspect-[9/16] max-h-80 bg-editor-stage">
        {clip?.status === 'done' && clip.url ? (
          <video src={clip.url} poster={clip.posterUrl || undefined} muted loop playsInline preload="metadata" controls className="h-full w-full object-cover" aria-label={`Clip for shot ${shot.id}`} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-bf-muted">
            {working ? <Loader2 className="animate-spin text-bf-gold" size={22} aria-hidden="true" /> : <Film size={22} aria-hidden="true" />}
            <span className="text-xs">{working ? (clip?.status === 'queued' ? 'Waiting to order' : 'BytePlus is making this clip') : 'No clip yet'}</span>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-bf-muted">
          <span className="font-medium text-bf-sub">Scene {scene?.number} · {shot.id}</span>
          {shot.suggested && <Badge variant="warning">Suggested</Badge>}
          {clip?.fromLibrary && <Badge>From library</Badge>}
          {clip?.status === 'done' && !clip.fromLibrary && <span className="tabular-nums">{money(clip.costUsd || 0)}</span>}
        </div>
        {clip?.status === 'error' && <p className="text-xs text-bf-danger">{clip.error}</p>}
        <Textarea aria-label={`Prompt for shot ${shot.id}`} rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} className="text-xs" />
        <div className="mt-auto flex flex-wrap gap-2">
          {dirty && <Button variant="secondary" className="!px-3 !py-1.5 text-xs" onClick={() => onEdit({ shots: [{ id: shot.id, prompt: prompt.trim() }] })}>Save prompt</Button>}
          {shot.suggested && !dirty && (
            <Button variant="secondary" className="!px-3 !py-1.5 text-xs" onClick={() => onEdit({ shots: [{ id: shot.id, accept: true }] })}>
              <Check size={14} aria-hidden="true" /> Accept
            </Button>
          )}
          <Button variant="ghost" className="!px-3 !py-1.5 text-xs" disabled={busy || working || dirty} onClick={() => onReroll(shot.id)} title={dirty ? 'Save the prompt first' : undefined}>
            <RefreshCw size={14} aria-hidden="true" /> {clip?.status === 'done' ? 'Re-roll' : 'Make this clip'}
          </Button>
          <Button variant="ghost" className="!px-3 !py-1.5 text-xs" disabled={working} onClick={onPickLibrary}>
            <Library size={14} aria-hidden="true" /> {shot.similar.length ? `Library (${shot.similar.length} close)` : 'Library'}
          </Button>
        </div>
      </div>
    </li>
  );
}

/** Each shot: its clip, its prompt, and the ways to fill it (order, re-roll, or reuse a library clip). */
export function ShotsPanel(props: Props) {
  const [picking, setPicking] = useState<SceneScriptShot | null>(null);
  return (
    <>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {props.project.shots.map((shot) => (
          <ShotCard key={`${shot.id}-${shot.effectivePrompt}`} {...props} shot={shot} onPickLibrary={() => setPicking(shot)} />
        ))}
      </ul>
      {picking && (
        <LibraryPicker
          aspect={props.project.meta.aspect}
          similar={picking.similar}
          onClose={() => setPicking(null)}
          onPick={(clipId) => { const id = picking.id; setPicking(null); void props.onUseLibrary(id, clipId); }}
        />
      )}
    </>
  );
}
