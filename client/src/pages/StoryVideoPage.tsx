import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Upload, Loader2, Download, X, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { storyApi } from '../lib/storyApi';
import { useStoryProject } from '../hooks/useStoryProject';
// StoryProject type no longer referenced here after removing the inline progress widget.
import {
  deriveStep, progressLabel, canRender, imageCounts, isTransientStatus, isStalled,
} from '../lib/storyWizard';
import { StylePicker } from '../components/story/StylePicker';
import { SceneCard } from '../components/story/SceneCard';
import { ProjectHistory } from '../components/story/ProjectHistory';
import { MusicPicker } from '../components/MusicPicker';
import { RenderProgressOverlay } from '../components/RenderProgressOverlay';
import { MediaTrimmer } from '../components/MediaTrimmer';
import { DropZone } from '../components/ui/DropZone';
import { ScriptForm } from '../components/story/ScriptForm';

const ACTIVE_KEY = 'BF_STORY_ACTIVE';

export function StoryVideoPage() {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState<string | null>(() => localStorage.getItem(ACTIVE_KEY));
  const [title, setTitle] = useState('');
  const [style, setStyle] = useState('cinematic-bible');
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingAudio, setPendingAudio] = useState<string | null>(null);
  const [showTrimmer, setShowTrimmer] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [defaultTitle, setDefaultTitle] = useState('');
  const [entryMode, setEntryMode] = useState<'upload' | 'script'>('upload');

  const { data: project } = useStoryProject(projectId);
  const refresh = () => { if (projectId) qc.invalidateQueries({ queryKey: ['story-project', projectId] }); };

  const setActive = (id: string | null) => {
    setProjectId(id);
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  };

  // Phase 1: upload the picked file, then hold its server path for the trim step.
  const handlePickFile = async (file: File) => {
    setBusy(true);
    try {
      setDefaultTitle(file.name.replace(/\.[^.]+$/, ''));
      const path = await storyApi.uploadAudio(file, file.name);
      setPendingAudio(path);
    } catch (e) {
      toast.error((e as Error).message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const handleGenerateScript = async (idea: string, templateId: string, voiceId: string) => {
    setBusy(true);
    try {
      setDefaultTitle(idea.slice(0, 60));
      const path = await storyApi.scriptToAudio(idea, templateId, voiceId);
      setPendingAudio(path);
    } catch (e) {
      toast.error((e as Error).message || 'Voice generation failed');
    } finally {
      setBusy(false);
    }
  };

  // Phase 2: run the pipeline on the chosen audio path (trimmed or full).
  const startPipeline = async (audioPath: string) => {
    setBusy(true);
    setShowTrimmer(false);
    try {
      const created = await storyApi.createProject(title || defaultTitle, style);
      setActive(created.projectId);
      await storyApi.process(created.projectId, audioPath);
      setPendingAudio(null);
      qc.invalidateQueries({ queryKey: ['story-project', created.projectId] });
      toast.success('Generating on the server — you can leave this page');
    } catch (e) {
      toast.error((e as Error).message || 'Something went wrong');
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const onPatch = async (sceneId: string, patch: { text?: string; imagePrompt?: string }) => {
    if (!projectId) return;
    try { await storyApi.patchScene(projectId, sceneId, patch); refresh(); }
    catch (e) { toast.error((e as Error).message); }
  };

  // Per-scene regenerate uses its own id (not the page-wide `busy`) so only the
  // clicked scene shows a spinner — not every card.
  const onRegenerate = async (sceneId: string) => {
    if (!projectId || regeneratingId) return;
    setRegeneratingId(sceneId);
    try {
      const updated = await storyApi.regenerateScene(projectId, sceneId);
      refresh();
      // Report the truth: the request succeeds even when the image itself
      // failed (e.g. quota), so check the scene's actual status.
      const sc = updated.scenes.find((s) => s.id === sceneId);
      if (sc && sc.imageStatus === 'error') toast.error(sc.imageError || 'Image generation failed');
      else toast.success('Image regenerated');
    } catch (e) { toast.error((e as Error).message); }
    finally { setRegeneratingId(null); }
  };

  const onRender = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      await storyApi.render(projectId);
      refresh();
      toast.success('Render started — running in the background. You can leave this page.');
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const retryFailedImages = async () => {
    if (!projectId || busy) return;
    setBusy(true);
    try { await storyApi.generateImages(projectId); refresh(); toast.success('Retrying failed images…'); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const regenerateAllImages = async () => {
    if (!projectId || busy) return;
    setBusy(true);
    try { await storyApi.regenerateAllImages(projectId); refresh(); toast.success('Regenerating all images…'); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const cancelJob = async () => {
    if (!projectId || busy) return;
    setBusy(true);
    try { await storyApi.cancel(projectId); refresh(); toast.success('Cancelled'); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const onMusicChange = async (next: { path: string | null; volume: number; autoDuck?: boolean }) => {
    if (!projectId) return;
    try {
      await storyApi.setMusic(projectId, { path: next.path, volume: next.volume, autoDuck: next.autoDuck ?? true });
      refresh();
    } catch (e) { toast.error((e as Error).message); }
  };

  // Re-drive an interrupted pipeline from whatever stage the project is in.
  const resume = async () => {
    if (!projectId || busy) return;
    setBusy(true);
    try {
      const p = await storyApi.getProject(projectId);
      const audioPath = p.source?.audioPath;
      if (!audioPath) {
        toast.error('Upload was interrupted — please start again.');
        setActive(null);
        return;
      }
      if (p.status === 'rendering') {
        await storyApi.render(projectId);
      } else {
        await storyApi.process(projectId, audioPath);
      }
      qc.invalidateQueries({ queryKey: ['story-project', projectId] });
      toast.success('Resumed');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Rebuild scenes from the transcript with the (capped) "fewer, longer scenes"
  // segmentation. Recovers a project that over-segmented into hundreds of
  // scenes and stalled while generating images.
  const resegment = async () => {
    if (!projectId || busy) return;
    setBusy(true);
    try {
      await storyApi.resegment(projectId);
      qc.invalidateQueries({ queryKey: ['story-project', projectId] });
      toast.success('Rebuilding with fewer scenes…');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const step = project ? deriveStep(project) : 1;
  const transient = project ? isTransientStatus(project.status) : false;
  const stalled = project ? isStalled(project, Date.now()) : false;
  const isError = project?.status === 'error';
  const cancelled = isError && /^cancelled/i.test(project?.error || '');
  const hasTranscript = (project?.transcript?.words?.length ?? 0) > 0;
  const hasScenes = (project?.scenes?.length ?? 0) > 0;
  const counts = project ? imageCounts(project.scenes) : { done: 0, total: 0 };
  // Live ffmpeg render progress. `percent` present ⇒ the render is actually
  // running in the server process; absent while "rendering" ⇒ the job died
  // (e.g. a redeploy) and we should offer Resume instead of a fake bar.
  const renderPct = typeof project?.render?.percent === 'number' ? project.render.percent : undefined;
  const renderLive = project?.status === 'rendering' && renderPct !== undefined;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-white">Story Video</h1>
        {project && (
          <button onClick={() => setActive(null)} className="text-xs text-gray-400 hover:text-gray-200">
            Start new
          </button>
        )}
      </div>

      {/* Actively working (non-render): show what's happening + a way to stop it.
          Rendering has its own progress card with a real % in step 3. */}
      {project && transient && project.status !== 'rendering' && !stalled && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary-500/30 bg-primary-500/[0.08] px-4 py-3">
          <span className="flex items-center gap-2 text-sm text-primary-100">
            <Loader2 className="animate-spin text-primary-400" size={16} />
            {progressLabel(project.status)}
            {project.status === 'generating_images' && (
              <span className="text-primary-300/80">{counts.done}/{counts.total}</span>
            )}
          </span>
          <button
            onClick={cancelJob}
            disabled={busy}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/15 px-3 py-1.5 text-sm text-gray-300 hover:border-red-400 hover:text-red-300 disabled:opacity-50"
          >
            <X size={14} /> Cancel
          </button>
        </div>
      )}

      {/* Interrupted (server died mid-run): offer to pick up or rebuild.
          Suppressed while a render is genuinely live (it has its own % card). */}
      {stalled && !renderLive && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <span className="text-sm text-amber-200">This project was interrupted. Pick up where it left off.</span>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              onClick={resume}
              disabled={busy}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-dark-900 hover:bg-amber-400 disabled:opacity-50"
            >
              Resume
            </button>
            {hasScenes && (
              <button
                onClick={retryFailedImages}
                disabled={busy}
                title="Reuse the transcript and scenes — just retry the images that failed."
                className="rounded-lg border border-amber-400/40 px-3 py-1.5 text-sm text-amber-200 hover:border-amber-300 disabled:opacity-50"
              >
                Retry failed images
              </button>
            )}
            {hasScenes && (
              <button
                onClick={resegment}
                disabled={busy}
                title="Discard the current scenes and rebuild with fewer, longer scenes — faster, and recovers a render stuck on hundreds of images."
                className="rounded-lg border border-amber-400/40 px-3 py-1.5 text-sm text-amber-200 hover:border-amber-300 disabled:opacity-50"
              >
                Re-segment (fewer scenes)
              </button>
            )}
            <button
              onClick={cancelJob}
              disabled={busy}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-gray-300 hover:border-red-400 hover:text-red-300 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Failed (or cancelled): reuse the transcript/audio instead of starting over.
          Cancellation is a user action, not an error, so it gets a calm neutral
          tone rather than alarming red. */}
      {isError && (
        <div className={`mt-4 rounded-xl border px-4 py-3 ${cancelled ? 'border-white/10 bg-white/[0.03]' : 'border-red-500/30 bg-red-500/10'}`}>
          <div className={`text-sm ${cancelled ? 'text-gray-300' : 'text-red-300'}`}>
            {cancelled ? 'Cancelled. Pick up where you left off:' : (project?.error || 'Something went wrong.')}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {hasScenes && (
              <button onClick={retryFailedImages} disabled={busy} className="inline-flex items-center gap-1 rounded-lg bg-primary-500 px-3 py-1.5 text-sm font-semibold text-dark-900 hover:bg-primary-400 disabled:opacity-50">
                <RefreshCw size={13} /> Retry failed images
              </button>
            )}
            {hasTranscript && (
              <button onClick={resegment} disabled={busy} title="Keep the transcript & audio; rebuild scenes." className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-gray-200 hover:border-primary-400 disabled:opacity-50">
                Re-segment (keep transcript)
              </button>
            )}
            <button onClick={() => setActive(null)} disabled={busy} className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200 disabled:opacity-50">
              Start over
            </button>
          </div>
        </div>
      )}

      {step === 1 && !transient && (
        <div className="mt-6 space-y-4">
          {!project && (
            <ProjectHistory
              onOpen={(id) => setActive(id)}
              activeId={projectId}
              onDeleted={() => setActive(null)}
            />
          )}
          {project?.error && !isError && <ErrorBanner message={project.error} />}
          <label className="block text-sm text-gray-300">
            Title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Trusting God in the waiting"
              className="mt-1 w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-white focus:border-primary-400 focus:outline-none"
            />
          </label>

          <div>
            <div className="text-sm text-gray-300 mb-2">Visual style</div>
            <StylePicker value={style} onChange={setStyle} />
          </div>

          {busy ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 flex items-center gap-3 text-sm text-gray-300">
              <Loader2 className="animate-spin text-primary-400" size={18} />
              {project && isTransientStatus(project.status) ? progressLabel(project.status) : 'Working…'}
            </div>
          ) : pendingAudio ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
              <div className="text-sm text-gray-200">Audio uploaded. Trim it, or use the whole thing.</div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setShowTrimmer(true)}
                  className="rounded-lg bg-primary-500 px-3 py-1.5 text-sm font-semibold text-dark-900 hover:bg-primary-400"
                >
                  Trim audio
                </button>
                <button
                  type="button"
                  onClick={() => startPipeline(pendingAudio)}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-gray-200 hover:border-primary-400"
                >
                  Use full audio
                </button>
                <button
                  type="button"
                  onClick={() => setPendingAudio(null)}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200"
                >
                  Pick a different file
                </button>
              </div>
              {showTrimmer && (
                <MediaTrimmer
                  serverPath={pendingAudio}
                  kind="audio"
                  onApply={(trimmedPath) => { setShowTrimmer(false); startPipeline(trimmedPath); }}
                  onCancel={() => setShowTrimmer(false)}
                />
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="inline-flex rounded-lg border border-white/10 p-0.5 text-sm">
                <button
                  type="button"
                  onClick={() => setEntryMode('upload')}
                  className={`rounded-md px-3 py-1 ${entryMode === 'upload' ? 'bg-white/10 text-white' : 'text-gray-400'}`}
                >
                  Upload audio
                </button>
                <button
                  type="button"
                  onClick={() => setEntryMode('script')}
                  className={`rounded-md px-3 py-1 ${entryMode === 'script' ? 'bg-white/10 text-white' : 'text-gray-400'}`}
                >
                  Write a script
                </button>
              </div>

              {entryMode === 'script' ? (
                <ScriptForm onGenerate={handleGenerateScript} busy={busy} />
              ) : (
                <DropZone
                  onFiles={(files) => { if (files[0]) handlePickFile(files[0]); }}
                  accept={['audio/*', 'video/*', '.mp3', '.m4a', '.wav', '.mp4', '.mov', '.webm']}
                  multiple={false}
                  disabled={busy}
                  overlayLabel="Drop a sermon file"
                >
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 bg-white/[0.02] px-4 py-8 text-sm text-gray-300 hover:border-primary-400 cursor-pointer"
                  >
                    <Upload size={18} />
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
            </div>
          )}
        </div>
      )}

      {step === 2 && project && (
        <div className="mt-6 space-y-3">
          {project.scenes.map((s) => (
            <SceneCard
              key={s.id}
              scene={s}
              onPatch={onPatch}
              onRegenerate={onRegenerate}
              busy={busy}
              regenerating={regeneratingId === s.id}
            />
          ))}
          {/* Bulk image controls — retry just the failures, or rebuild all. */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <span className="text-xs text-gray-400">
              Images: {counts.done}/{counts.total} ready
              {counts.total - counts.done > 0 && (
                <span className="text-red-300/80"> · {counts.total - counts.done} failed</span>
              )}
            </span>
            <div className="ml-auto flex flex-wrap gap-2">
              {counts.done < counts.total && (
                <button
                  onClick={retryFailedImages}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-3 py-1.5 text-xs text-gray-200 hover:border-primary-400 disabled:opacity-50"
                >
                  <RefreshCw size={12} /> Retry failed images
                </button>
              )}
              <button
                onClick={regenerateAllImages}
                disabled={busy}
                title="Discard every current image and regenerate them all from scratch."
                className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-3 py-1.5 text-xs text-gray-200 hover:border-primary-400 disabled:opacity-50"
              >
                <RefreshCw size={12} /> Regenerate all
              </button>
            </div>
          </div>
          <MusicPicker
            value={project.music ?? { path: null, volume: 0.3, autoDuck: true }}
            onChange={onMusicChange}
            busy={busy}
          />
          <button
            onClick={onRender}
            disabled={!canRender(project) || busy}
            className="w-full rounded-xl bg-primary-500 px-4 py-3 text-sm font-semibold text-dark-900 hover:bg-primary-400 disabled:opacity-50"
          >
            {canRender(project) ? 'Looks good → Render' : 'Waiting for all images…'}
          </button>
          <button
            onClick={resegment}
            disabled={busy}
            className="w-full text-center text-xs text-gray-500 hover:text-gray-300 disabled:opacity-50"
          >
            Too many scenes, or images stuck? Re-segment with fewer, longer scenes
          </button>
        </div>
      )}

      {step === 3 && project && (
        <div className="mt-6 space-y-4">
          {project.status === 'rendering' && renderLive && (
            <>
              <RenderProgressOverlay active mode="queued" progress={renderPct} />
              <div className="flex justify-center">
                <button
                  onClick={cancelJob}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-3 py-1.5 text-sm text-gray-300 hover:border-red-400 hover:text-red-300 disabled:opacity-50"
                >
                  <X size={14} /> Cancel render
                </button>
              </div>
            </>
          )}
          {project.status === 'done' && project.render.outputPath && (
            <DonePanel projectId={project.projectId} />
          )}
          {project.status === 'error' && <ErrorBanner message={project.error || 'Render failed'} />}
        </div>
      )}
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
      {message}
    </div>
  );
}

function DonePanel({ projectId }: { projectId: string }) {
  // Render output is deterministic: outputs/story/<projectId>/video.mp4.
  // projectId is a uuid (untouched by the server's path sanitiser). Token is
  // appended because <video> can't send an Authorization header and the
  // server's requireAuth accepts ?token= (see api.ts). Harmless if public.
  const token = api.getToken();
  const base = `${api.mediaBaseUrl}/outputs/story/${projectId}/video.mp4`;
  const url = token ? `${base}?token=${encodeURIComponent(token)}` : base;
  return (
    <div className="space-y-3">
      <video src={url} controls className="w-full rounded-xl border border-white/10" />
      <button
        onClick={() => api.downloadMedia(base, 'story-video.mp4')}
        className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-dark-900 hover:bg-primary-400"
      >
        <Download size={16} /> Download MP4
      </button>
    </div>
  );
}
