import { useState } from 'react';
import { AlertTriangle, Clapperboard, Download, Mic, Sparkles, Square } from 'lucide-react';
import { Button } from '../ui/Button';
import type { SceneScriptProject } from '../../lib/sceneScriptTypes';
import { clock, money } from './format';

interface Props {
  project: SceneScriptProject;
  month: { spentUsd: number; capUsd: number } | null;
  seedance: boolean;
  busy: string | null;
  onVoice: () => void;
  onSuggest: () => void;
  onOrder: (confirmOverBenchmark: boolean) => void;
  onCancelShots: () => void;
  onRender: () => void;
  onCancelRender: () => void;
}

function Step({ n, title, status, children }: { n: number; title: string; status: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-card border border-editor-line bg-bf-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-bf-cream">{n}. {title}</h2>
        <span className="text-xs text-bf-muted">{status}</span>
      </div>
      {children}
    </div>
  );
}

function VoiceStep({ project, busy, onVoice }: Pick<Props, 'project' | 'busy' | 'onVoice'>) {
  const voiced = project.lines.filter((l) => l.audio).length;
  return (
    <Step n={1} title="Voices" status={project.running.voice ? 'Recording…' : `${voiced} of ${project.lines.length} lines`}>
      <p className="text-help">
        {project.timeline ? `Length ${clock(project.timeline.total)}.` : 'Each line is recorded in its own voice.'}
        {project.needsVoice && voiced > 0 ? ' Some lines changed since they were recorded.' : ''}
      </p>
      <Button onClick={onVoice} isLoading={busy === 'voice' || project.running.voice} disabled={!project.needsVoice || project.running.voice}>
        <Mic size={16} aria-hidden="true" /> {!voiced ? 'Record voices' : project.needsVoice ? 'Record changed lines' : 'All lines recorded'}
      </Button>
    </Step>
  );
}

function ClipsSummary({ project, month }: Pick<Props, 'project' | 'month'>) {
  const est = project.estimate;
  return (
    <>
      <p className="text-help tabular-nums">
        {est.clips ? `${est.clips} clips to make, about ${money(est.usd)}.` : est.refetch ? '' : 'Every shot has a clip.'}
        {est.refetch ? ` ${est.refetch} paid clip(s) to fetch again at no cost.` : ''}
        {' '}This video so far {money(est.spentUsd)}.
        {month ? ` Month ${money(month.spentUsd)} of ${money(month.capUsd)}.` : ''}
      </p>
      {est.overBenchmark && est.clips > 0 && (
        <p className="flex items-start gap-2 text-xs text-bf-warn">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          About {money(est.totalUsd)} in all, above the {money(est.benchmarkUsd)} benchmark per video.
        </p>
      )}
    </>
  );
}

function ClipsStep(p: Pick<Props, 'project' | 'month' | 'seedance' | 'busy' | 'onSuggest' | 'onOrder' | 'onCancelShots'>) {
  const { project, busy } = p;
  const [confirming, setConfirming] = useState(false);
  const est = project.estimate;
  const shotsDone = project.shots.filter((s) => s.clip?.status === 'done').length;
  return (
    <Step n={2} title="Clips" status={project.running.shots ? 'Making clips…' : `${shotsDone} of ${project.shots.length} shots`}>
      <ClipsSummary project={project} month={p.month} />
      {!p.seedance && <p className="text-xs text-bf-danger">AI video is not set up on this server.</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={p.onSuggest} isLoading={busy === 'suggest'} disabled={busy !== null || project.running.shots}>
          <Sparkles size={16} aria-hidden="true" /> Suggest shot prompts
        </Button>
        {project.running.shots ? (
          <Button variant="ghost" onClick={p.onCancelShots}><Square size={14} aria-hidden="true" /> Stop ordering</Button>
        ) : confirming ? (
          <>
            <Button onClick={() => { setConfirming(false); p.onOrder(true); }}>Make clips for {money(est.usd)}</Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>Not now</Button>
          </>
        ) : (
          <Button
            onClick={() => (est.overBenchmark ? setConfirming(true) : p.onOrder(false))}
            isLoading={busy === 'order'}
            disabled={!(est.clips || est.refetch) || busy !== null || !p.seedance}
          >
            Make clips
          </Button>
        )}
      </div>
    </Step>
  );
}

function RenderResult({ render }: { render: SceneScriptProject['render'] }) {
  if (render.status !== 'done' || !render.url) return null;
  return (
    <>
      <video src={render.url} controls playsInline preload="metadata" className="mt-1 max-h-96 w-full rounded-lg bg-editor-stage" aria-label="Rendered video" />
      <p className="text-xs tabular-nums text-bf-muted">{clock(render.durationSec)} · {((render.sizeBytes || 0) / 1e6).toFixed(0)} MB · rendered in {clock(render.renderSec)}</p>
    </>
  );
}

function VideoStep({ project, busy, onRender, onCancelRender }: Pick<Props, 'project' | 'busy' | 'onRender' | 'onCancelRender'>) {
  const render = project.render;
  const rendering = project.running.render || render.status === 'queued' || render.status === 'rendering';
  return (
    <Step n={3} title="Video" status={rendering ? `Rendering ${render.progress ?? 0}%` : render.status === 'done' ? 'Ready' : ''}>
      {project.blockers.length > 0 && !rendering && (
        <ul className="space-y-1">{project.blockers.map((b) => <li key={b} className="text-help">{b}</li>)}</ul>
      )}
      {render.status === 'error' && <p className="text-xs text-bf-danger">{render.error}</p>}
      {rendering && (
        <div className="h-1.5 overflow-hidden rounded-full bg-bf-input" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={render.progress ?? 0} aria-label="Render progress">
          <div className="h-full bg-accent-fill transition-[width] duration-200" style={{ width: `${render.progress ?? 0}%` }} />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {rendering ? (
          <Button variant="ghost" onClick={onCancelRender}><Square size={14} aria-hidden="true" /> Stop render</Button>
        ) : (
          <Button onClick={onRender} isLoading={busy === 'render'} disabled={project.blockers.length > 0 || project.needsVoice || busy !== null}>
            <Clapperboard size={16} aria-hidden="true" /> {render.status === 'done' ? 'Render again' : 'Render video'}
          </Button>
        )}
        {render.status === 'done' && render.url && (
          <a href={render.url} download className="btn btn-secondary inline-flex items-center gap-2 text-sm">
            <Download size={16} aria-hidden="true" /> Download
          </a>
        )}
      </div>
      <RenderResult render={render} />
    </Step>
  );
}

/** The three paid or heavy steps in order: voice, clips, render. */
export function ProductionBar(p: Props) {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <VoiceStep project={p.project} busy={p.busy} onVoice={p.onVoice} />
      <ClipsStep {...p} />
      <VideoStep project={p.project} busy={p.busy} onRender={p.onRender} onCancelRender={p.onCancelRender} />
    </div>
  );
}
