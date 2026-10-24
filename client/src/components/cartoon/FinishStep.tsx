/**
 * Step 6 of a cartoon: finish and deliver. The captions switch, the music bed
 * (the same library list Human mode's MusicPanel uses, plus "No music") and
 * the end-card text are saved as they change, and Render waits for a save
 * still in flight so the film never renders the old text. Render starts the
 * film; the server's NOT_READY blockers are listed, and its render warnings (a shot
 * made from an out-of-date frame) are shown without stopping the render.
 * A finished film offers the video, a download, the post caption with Copy,
 * YouTube publishing with the clips' poster frames as thumbnails, and TikTok
 * publishing to the account connected in Settings.
 */
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Clapperboard, Copy, Download, Square } from 'lucide-react';
import { cartoonApi } from '../../lib/cartoonApi';
import { isApiError } from '../../lib/apiError';
import { toastError } from '../../lib/errors';
import { fetchMusicLibrary, type MusicTrack } from '../../lib/musicLibraryApi';
import type { CartoonEdit, CartoonErrorPayload, CartoonProject } from '../../lib/cartoonTypes';
import { Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { YoutubePublishPanel } from '../share/YoutubePublishPanel';
import { TikTokPostPanel } from '../share/TikTokPostPanel';
import { postCaption, posterOptions, secs } from './film';

interface Props {
  project: CartoonProject;
  onSaved: (project: CartoonProject) => void;
}

/** Longest end-card text the server keeps (MAX_END_CARD_CHARS in edits.js). */
const MAX_END_CARD_CHARS = 200;
const COPIED_MS = 2000;

type Problem = { blockers: string[] } | { message: string };

const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

function useBeds(): MusicTrack[] {
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  useEffect(() => {
    let live = true;
    fetchMusicLibrary().then((t) => { if (live) setTracks(t); }).catch(() => { if (live) setTracks([]); });
    return () => { live = false; };
  }, []);
  // Songs with singing would talk over the characters.
  return tracks.filter((t) => !/\(vocal\)/.test(t.label));
}

function CaptionsSwitch({ checked, disabled, onChange }: { checked: boolean; disabled: boolean; onChange: (next: boolean) => void }) {
  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby="cartoon-captions-label"
        aria-describedby="cartoon-captions-help"
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-accent disabled:cursor-not-allowed disabled:opacity-60 ${
          checked ? 'border-transparent bg-accent-fill' : 'border-editor-line bg-editor-panel'
        }`}
      >
        <span
          aria-hidden="true"
          className={`inline-block h-4 w-4 rounded-full transition-transform duration-150 motion-reduce:transition-none ${checked ? 'translate-x-5 bg-accent-ink' : 'translate-x-1 bg-editor-dim'}`}
        />
      </button>
      <div className="min-w-0">
        <span id="cartoon-captions-label" className="text-sm text-bf-cream">Captions</span>
        <p id="cartoon-captions-help" className="text-help">The dialogue on screen, with each speaker's name the first time they speak.</p>
      </div>
    </div>
  );
}

interface SettingsProps {
  project: CartoonProject;
  disabled: boolean;
  onSaved: Props['onSaved'];
  /** A save in flight; owned by the step so Render can wait for it. */
  saving: boolean;
  setSaving: (saving: boolean) => void;
}

function Settings({ project, disabled, onSaved, saving, setSaving }: SettingsProps) {
  const beds = useBeds();
  const [endCard, setEndCard] = useState(project.endCard.text);
  useEffect(() => { setEndCard(project.endCard.text); }, [project.endCard.text]);
  const bed = project.music.bed ?? '';
  const off = disabled || saving;

  const save = async (edit: CartoonEdit) => {
    setSaving(true);
    try {
      onSaved(await cartoonApi.update(project.id, edit));
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 rounded-card border border-editor-line bg-bf-card p-4">
      <CaptionsSwitch checked={project.captions.enabled} disabled={off} onChange={(enabled) => { void save({ captions: { enabled } }); }} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Music bed" htmlFor="cartoon-bed" hint="Ducked under the speech automatically.">
          <Select id="cartoon-bed" value={bed} disabled={off} onChange={(e) => { void save({ bed: e.target.value || null }); }}>
            <option value="">No music</option>
            {bed && !beds.some((t) => t.ref === bed) && <option value={bed}>{bed}</option>}
            {beds.map((t) => <option key={t.ref} value={t.ref}>{t.label}{t.source === 'upload' ? ' (yours)' : ''}</option>)}
          </Select>
        </Field>
        <Field label="End card text" htmlFor="cartoon-end-card" hint="Shown for 3 s at the end of the film.">
          <Input
            id="cartoon-end-card"
            value={endCard}
            maxLength={MAX_END_CARD_CHARS}
            disabled={off}
            onChange={(e) => setEndCard(e.target.value)}
            onBlur={() => { const text = endCard.trim(); if (text !== project.endCard.text.trim()) void save({ endCard: { text } }); }}
          />
        </Field>
      </div>
    </div>
  );
}

function ProblemNote({ problem }: { problem: Problem }) {
  if ('message' in problem) return <p role="alert" className="text-sm text-bf-danger">{problem.message}</p>;
  return (
    <div role="alert" className="space-y-1">
      <p className="text-sm text-bf-danger">The film can't be rendered yet:</p>
      <ul className="list-disc space-y-1 pl-5">{problem.blockers.map((b) => <li key={b} className="text-sm text-bf-danger">{b}</li>)}</ul>
    </div>
  );
}

function PostCaption({ caption }: { caption: string }) {
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(caption);
      setCopied('yes');
    } catch {
      setCopied('failed');
    }
    timer.current = setTimeout(() => setCopied(null), COPIED_MS);
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-bf-cream">Post caption</h3>
        <div className="flex items-center gap-3">
          <span role="status" className="inline-flex items-center gap-1 text-xs text-bf-sub">
            {copied === 'yes' && <><Check size={14} aria-hidden="true" />Copied</>}
            {copied === 'failed' && 'Could not copy. Select the text and copy it.'}
          </span>
          <Button variant="secondary" className="!px-3 !py-1.5 text-sm" onClick={() => { void copy(); }}>
            <Copy size={14} aria-hidden="true" /> Copy caption
          </Button>
        </div>
      </div>
      <p className="whitespace-pre-wrap rounded-lg border border-editor-line bg-bf-input p-3 text-sm text-bf-cream">{caption}</p>
    </div>
  );
}

function Result({ project }: { project: CartoonProject }) {
  const { render } = project;
  if (render.status !== 'done' || !render.url) return null;
  const caption = postCaption(project);
  const meta = [
    typeof render.durationSec === 'number' ? `${secs(Math.round(render.durationSec * 10) / 10)} s` : null,
    typeof render.sizeBytes === 'number' ? `${(render.sizeBytes / 1e6).toFixed(1)} MB` : null,
  ].filter(Boolean).join(' · ');
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
      <div className="space-y-2">
        <video src={render.url} controls playsInline preload="metadata" className="aspect-[9/16] w-full rounded-lg bg-editor-stage" aria-label="Finished film" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          {meta && <span className="text-xs tabular-nums text-bf-muted">{meta}</span>}
          <a href={render.url} download className="btn btn-secondary inline-flex items-center gap-2 text-sm">
            <Download size={16} aria-hidden="true" /> Download
          </a>
        </div>
      </div>
      <div className="min-w-0 space-y-6">
        <PostCaption caption={caption} />
        <YoutubePublishPanel
          key={render.url}
          videoUrl={render.url}
          initial={{ title: project.meta.title, description: caption, thumbnailTitle: false }}
          thumbnailOptions={posterOptions(project.shots)}
        />
        <TikTokPostPanel key={`tiktok:${render.url}`} videoUrl={render.url} caption={caption} title={project.meta.title} />
      </div>
    </div>
  );
}

export function FinishStep({ project, onSaved }: Props) {
  const [busy, setBusy] = useState<'render' | 'stop' | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [saving, setSaving] = useState(false);
  const { render, running, renderBlockers, renderWarnings } = project;
  const rendering = running.render || render.status === 'queued' || render.status === 'rendering';
  const progress = Math.max(0, Math.min(100, Math.round(render.progress ?? 0)));

  const start = async () => {
    setBusy('render');
    setProblem(null);
    try {
      onSaved(await cartoonApi.render(project.id));
    } catch (e) {
      const blockers = isApiError(e) && e.code === 'NOT_READY' ? (e.payload as CartoonErrorPayload).blockers : undefined;
      setProblem(blockers?.length ? { blockers } : { message: errorText(e, 'Could not start the render.') });
    } finally {
      setBusy(null);
    }
  };

  const stop = async () => {
    setBusy('stop');
    try {
      await cartoonApi.cancelRender(project.id);
    } catch (e) {
      setProblem({ message: errorText(e, 'Could not stop the render.') });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <Settings project={project} disabled={rendering} onSaved={onSaved} saving={saving} setSaving={setSaving} />
      <div className="space-y-4 rounded-card border border-editor-line bg-bf-card p-4">
        {renderWarnings.length > 0 && (
          <ul className="space-y-1">
            {renderWarnings.map((w) => (
              <li key={w} className="flex items-start gap-2 text-sm text-bf-warn">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />{w}
              </li>
            ))}
          </ul>
        )}
        {!rendering && renderBlockers.length > 0 && !problem && <ProblemNote problem={{ blockers: renderBlockers }} />}
        {problem && <ProblemNote problem={problem} />}
        {render.status === 'error' && render.error && !rendering && <p className="text-sm text-bf-danger">{render.error}</p>}
        {render.status === 'cancelled' && !rendering && <p className="text-help">The render was stopped.</p>}
        {rendering && (
          <div className="space-y-1.5" aria-live="polite">
            <p className="text-sm tabular-nums text-bf-cream">{render.status === 'queued' ? 'Waiting to render' : `Rendering ${progress}%`}</p>
            <div className="h-1.5 overflow-hidden rounded-full bg-bf-input" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label="Render progress">
              <div className="h-full bg-accent-fill transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {rendering ? (
            <Button variant="ghost" onClick={stop} isLoading={busy === 'stop'}><Square size={14} aria-hidden="true" /> Stop render</Button>
          ) : (
            <Button
              variant={render.status === 'done' ? 'secondary' : 'primary'}
              onClick={start}
              isLoading={busy === 'render'}
              disabled={busy !== null || saving || running.film || renderBlockers.length > 0}
            >
              <Clapperboard size={16} aria-hidden="true" /> {render.status === 'done' ? 'Render again' : 'Render the film'}
            </Button>
          )}
        </div>
        <Result project={project} />
      </div>
    </div>
  );
}
