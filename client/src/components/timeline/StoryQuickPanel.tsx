import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Loader2, Upload, X, RefreshCw, ArrowDownToLine } from 'lucide-react';
import { storyApi } from '../../lib/storyApi';
import { useStoryProject } from '../../hooks/useStoryProject';
import {
  deriveStep, progressLabel, imageCounts, isTransientStatus, isStalled, canRender, STORY_STYLES,
} from '../../lib/storyWizard';
import { ScriptForm } from '../story/ScriptForm';
import { StoryScenePreview } from '../story/StoryScenePreview';
import { MusicPicker } from '../MusicPicker';
import { StoryStepper } from '../story/StoryStepper';
import { DropZone } from '../ui/DropZone';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

/**
 * The Story QUICK job, docked in the Timeline editor.
 *
 * The SAME pipeline as the Story Video page - same storyApi, same active
 * project key, so the two surfaces always show the same project. Condensed to
 * panel width: create (upload or write), watch the 5 stages with the page's
 * real recovery actions, and when the render is done LAND it on this timeline
 * as source media. Trimming and per-scene tuning stay on the Story page - one
 * tap away, never a dead end.
 */

const ACTIVE_KEY = 'BF_STORY_ACTIVE';

export interface StoryQuickPanelProps {
  /** Lands the finished render on the timeline as source media. */
  onUseVideo: (outputPath: string) => void;
  /** Plays the finished render center-stage, right here in the editor. */
  onPreviewVideo: (outputPath: string) => void;
}

export function StoryQuickPanel({ onUseVideo, onPreviewVideo }: StoryQuickPanelProps) {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState<string | null>(() => localStorage.getItem(ACTIVE_KEY));
  const [title, setTitle] = useState('');
  const [style, setStyle] = useState('cinematic-bible');
  const [entryMode, setEntryMode] = useState<'upload' | 'script'>('upload');
  const [busy, setBusy] = useState(false);
  // Per-scene regenerate: only the clicked row spins, like the classic page.
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: project } = useStoryProject(projectId);
  const refresh = () => { if (projectId) qc.invalidateQueries({ queryKey: ['story-project', projectId] }); };

  const setActive = (id: string | null) => {
    setProjectId(id);
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  };

  const startPipeline = async (audioPath: string, fallbackTitle: string) => {
    setBusy(true);
    try {
      const created = await storyApi.createProject(title || fallbackTitle, style);
      setActive(created.projectId);
      await storyApi.process(created.projectId, audioPath);
      qc.invalidateQueries({ queryKey: ['story-project', created.projectId] });
      toast.success('Generating on the server — keep editing, it lands here');
    } catch (e) {
      toast.error((e as Error).message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const handlePickFile = async (file: File) => {
    setBusy(true);
    try {
      const path = await storyApi.uploadAudio(file, file.name);
      await startPipeline(path, file.name.replace(/\.[^.]+$/, ''));
    } catch (e) {
      toast.error((e as Error).message || 'Upload failed');
      setBusy(false);
    }
  };

  const handleGenerateScript = async (idea: string, templateId: string, voiceId: string) => {
    setBusy(true);
    try {
      const path = await storyApi.scriptToAudio(idea, templateId, voiceId);
      await startPipeline(path, idea.slice(0, 60));
    } catch (e) {
      toast.error((e as Error).message || 'Voice generation failed');
      setBusy(false);
    }
  };

  const act = (fn: () => Promise<unknown>, done?: string) => async () => {
    if (busy) return;
    setBusy(true);
    try { await fn(); refresh(); if (done) toast.success(done); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  // Regenerate ONE scene's image and report the truth: the request succeeds
  // even when the image itself failed (e.g. quota), so check the scene's
  // actual status - same lesson the classic page carries.
  const regenerateScene = async (sceneId: string) => {
    if (!projectId || regeneratingId) return;
    setRegeneratingId(sceneId);
    try {
      const updated = await storyApi.regenerateScene(projectId, sceneId);
      refresh();
      const sc = updated.scenes.find((s) => s.id === sceneId);
      if (sc && sc.imageStatus === 'error') toast.error(sc.imageError || 'Image generation failed');
      else toast.success('Image regenerated');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRegeneratingId(null);
    }
  };

  // ---- No project: the entry form ----------------------------------------
  if (!project) {
    return (
      <div className="space-y-3">
        <p className="text-[11px] leading-relaxed text-editor-dim">
          Verse to cinematic scenes — generated on the server, landing here when done.
        </p>
        <label className="block text-[10px] font-semibold text-editor-dim">
          Title
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Trusting God in the waiting"
            className="mt-1 bg-black/20"
          />
        </label>
        {/* Compact style chips - the page's big cards ate half the panel.
            Same STORY_STYLES source; the blurb survives as the tooltip. */}
        <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Visual style">
          {STORY_STYLES.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={s.id === style}
              title={s.blurb}
              onClick={() => setStyle(s.id)}
              className={`rounded-lg border px-2 py-1.5 text-left text-[10.5px] font-semibold transition-colors ${
                s.id === style
                  ? 'border-editor-accent/50 bg-editor-hover text-editor-accent'
                  : 'border-editor-line text-editor-dim hover:text-editor-text'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-lg border border-editor-line p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setEntryMode('upload')}
            className={`rounded-md px-3 py-1 ${entryMode === 'upload' ? 'bg-editor-hover text-editor-text' : 'text-editor-faint'}`}
          >
            Upload audio
          </button>
          <button
            type="button"
            onClick={() => setEntryMode('script')}
            className={`rounded-md px-3 py-1 ${entryMode === 'script' ? 'bg-editor-hover text-editor-text' : 'text-editor-faint'}`}
          >
            Write a script
          </button>
        </div>
        {busy ? (
          <div className="flex items-center gap-2 rounded-xl border border-editor-line p-3 text-xs text-editor-dim">
            <Loader2 className="animate-spin text-editor-accent" size={15} /> Working…
          </div>
        ) : entryMode === 'script' ? (
          <ScriptForm onGenerate={handleGenerateScript} busy={busy} />
        ) : (
          <DropZone
            onFiles={(files) => { if (files[0]) handlePickFile(files[0]); }}
            accept={['audio/*', 'video/*', '.mp3', '.m4a', '.wav', '.mp4', '.mov', '.webm']}
            multiple={false}
            disabled={busy}
            overlayLabel="Drop a sermon file"
          >
            {/* Click opens the picker; drop still works. A styled div alone
                LOOKED clickable but was not - the operator hit it first. */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-editor-line px-3 py-5 text-xs text-editor-dim transition-colors hover:border-editor-accent/50 hover:text-editor-text"
            >
              <Upload size={15} />
              Upload a sermon (MP3/M4A/MP4)
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handlePickFile(f);
                e.target.value = '';
              }}
            />
          </DropZone>
        )}
        <p className="text-[10px] leading-relaxed text-editor-faint">
          Need to trim the audio first, or tune scenes and images? The Story page has the full workbench — this panel tracks the same project.
        </p>
      </div>
    );
  }

  // ---- Active project: pipeline status + landing --------------------------
  const step = deriveStep(project);
  const transient = isTransientStatus(project.status);
  const stalled = isStalled(project, Date.now());
  const counts = imageCounts(project.scenes);
  // Leading slash matters: mediaUrl keeps a /outputs/ path INTACT, while a
  // bare relative path is stripped to its basename - a 404 for this nested
  // story dir.
  const doneVideo = project.status === 'done' && project.render?.outputPath
    ? `/outputs/story/${project.projectId}/video.mp4`
    : null;
  const renderPct = typeof project.render?.percent === 'number' ? project.render.percent : undefined;

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 break-words text-xs font-bold text-editor-text">{project.title}</p>
        <button
          type="button"
          onClick={() => setActive(null)}
          className="shrink-0 text-[10px] text-editor-faint hover:text-editor-text"
        >
          Start new
        </button>
      </div>
      <StoryStepper project={project} />

      {/* The classic page shows the current scene ON THE FLY while scenes and
          images generate - same component, docked. Hidden once the final
          render exists (the stage preview takes over). */}
      {project.scenes.length > 0 && !doneVideo && (
        <StoryScenePreview scenes={project.scenes} />
      )}

      {/* Per-scene insight, like classic's scene cards: WHICH image failed and
          WHY, with a targeted retry - a bulk retry that fails again otherwise
          just looks dead. */}
      {project.scenes.length > 0 && !doneVideo && (
        <div className="space-y-1">
          <p className="text-[9px] font-bold uppercase tracking-[.1em] text-editor-faint">
            Scenes · {counts.done}/{counts.total} images ready
            {counts.total - counts.done > 0 && <span className="text-bf-danger"> · {counts.total - counts.done} failed</span>}
          </p>
          <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
            {project.scenes.map((s, i) => (
              <div key={s.id} className="rounded-lg border border-editor-line bg-white/[0.02] px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-4 shrink-0 text-[10px] font-bold tabular-nums text-editor-accent">{i + 1}</span>
                  <span className={`flex-1 text-[9.5px] font-semibold uppercase tracking-wide ${
                    s.imageStatus === 'done' ? 'text-bf-success'
                      : s.imageStatus === 'generating' ? 'text-editor-accent'
                      : s.imageStatus === 'error' ? 'text-bf-danger'
                      : 'text-editor-faint'
                  }`}>
                    {s.imageStatus === 'done' ? 'Ready'
                      : s.imageStatus === 'generating' ? 'Rendering'
                      : s.imageStatus === 'error' ? 'Failed'
                      : 'Queued'}
                  </span>
                  {s.imageStatus === 'error' && (
                    <button
                      type="button"
                      onClick={() => regenerateScene(s.id)}
                      disabled={busy || regeneratingId !== null}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-editor-line px-1.5 py-0.5 text-[9.5px] font-semibold text-editor-accent hover:bg-editor-hover disabled:opacity-50"
                    >
                      {regeneratingId === s.id
                        ? <Loader2 size={9} className="animate-spin" />
                        : <RefreshCw size={9} />}
                      Regenerate
                    </button>
                  )}
                </div>
                {s.imageStatus === 'error' && s.imageError && (
                  <p className="mt-1 break-words text-[9px] leading-snug text-bf-danger/80">{s.imageError}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {transient && !stalled && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-editor-line bg-editor-hover px-3 py-2">
          <span className="flex min-w-0 items-center gap-2 text-[11px] text-editor-text">
            <Loader2 className="shrink-0 animate-spin text-editor-accent" size={13} />
            <span className="min-w-0 break-words">{progressLabel(project.status)}</span>
            {project.status === 'generating_images' && (
              <span className="shrink-0 font-mono text-editor-dim">{counts.done}/{counts.total}</span>
            )}
          </span>
          <button onClick={act(() => storyApi.cancel(project.projectId), 'Cancelled')} disabled={busy} aria-label="Cancel" className="shrink-0 rounded p-1 text-editor-faint hover:text-red-300">
            <X size={13} />
          </button>
        </div>
      )}

      {/* Calm, on-palette recovery - not an amber alarm box. The state is
          ordinary ("pick up where you left off"), so it dresses like the rest
          of the editor: cream text, gold primary, hairline secondaries. */}
      {(stalled || project.status === 'error') && (
        <div className="space-y-2 rounded-xl border border-editor-line bg-white/[0.03] p-3">
          <p className="break-words text-[11px] leading-relaxed text-editor-text">
            {project.status === 'error'
              ? (/^cancelled/i.test(project.error || '') ? 'Cancelled — pick up where you left off.' : (project.error || 'Something went wrong.'))
              : 'Interrupted — pick up where it left off.'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={act(async () => {
                // Re-drive the pipeline from whatever stage it died in - the
                // same resume the Story page has.
                const audioPath = project.source?.audioPath;
                if (!audioPath) {
                  toast.error('Upload was interrupted — please start again.');
                  setActive(null);
                  return;
                }
                if (project.status === 'rendering') await storyApi.render(project.projectId);
                else await storyApi.process(project.projectId, audioPath);
              }, 'Resumed')}
              disabled={busy}
              className="rounded-md bg-editor-accent px-2.5 py-1 text-[10px] font-bold text-editor-chrome disabled:opacity-50"
            >
              Resume
            </button>
            {project.scenes.length > 0 && (
              <button onClick={act(() => storyApi.generateImages(project.projectId), 'Retrying failed images…')} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-editor-line px-2 py-1 text-[10px] text-editor-dim hover:text-editor-text disabled:opacity-50">
                <RefreshCw size={10} /> Retry failed images
              </button>
            )}
            {(project.transcript?.words?.length ?? 0) > 0 && (
              <button onClick={act(() => storyApi.resegment(project.projectId), 'Rebuilding with fewer scenes…')} disabled={busy} className="rounded-md border border-editor-line px-2 py-1 text-[10px] text-editor-dim hover:text-editor-text disabled:opacity-50">
                Re-segment
              </button>
            )}
            <button onClick={() => setActive(null)} disabled={busy} className="rounded-md border border-white/15 px-2 py-1 text-[10px] text-editor-dim disabled:opacity-50">
              Start over
            </button>
          </div>
        </div>
      )}

      {/* Step 2 controls show whenever scenes exist and no render is done -
          NOT gated on a quiet status. Classic shows music + the render gate
          even while a stale "generating_images" status lingers; hiding them
          here left 8/8 READY with no way forward. */}
      {step === 2 && (
        <div className="space-y-2">
          <div role="group" aria-label="Background music">
            <MusicPicker
              value={project.music ?? { path: null, volume: 0.3, autoDuck: true }}
              onChange={(m) => act(async () => {
                await storyApi.setMusic(project.projectId, {
                  path: m.path || null,
                  volume: m.volume,
                  autoDuck: m.autoDuck ?? true,
                });
              })()}
              busy={busy}
            />
          </div>
          <Button
            onClick={act(() => storyApi.render(project.projectId), 'Render started — it lands here when done')}
            disabled={!canRender(project) || busy}
            className="h-9 w-full text-xs"
          >
            {canRender(project) ? 'Looks good → Render' : 'Waiting for all images…'}
          </Button>
        </div>
      )}

      {project.status === 'rendering' && renderPct !== undefined && (
        <div className="space-y-1.5">
          <p className="text-[11px] text-editor-dim">Rendering… <span className="font-mono text-editor-text">{Math.round(renderPct)}%</span></p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-primary-500 transition-all duration-150" style={{ width: `${Math.max(2, renderPct)}%` }} />
          </div>
        </div>
      )}

      {doneVideo && (
        <div className="space-y-2 rounded-xl border border-editor-line bg-white/[0.02] p-3">
          <p className="text-[11px] font-semibold text-editor-text">Render done.</p>
          <Button
            onClick={() => onPreviewVideo(doneVideo)}
            className="h-9 w-full text-xs"
          >
            Preview on stage
          </Button>
          <Button
            variant="secondary"
            onClick={() => onUseVideo(doneVideo)}
            className="h-9 w-full border-editor-line text-xs"
          >
            <ArrowDownToLine size={14} className="mr-1.5" />
            Use as source media
          </Button>
          <p className="text-[10px] leading-relaxed text-editor-faint">
            Preview plays it center-stage right here. Use-as-source loads it onto THIS timeline — captions, music and effects layer on top.
          </p>
        </div>
      )}
    </div>
  );
}
