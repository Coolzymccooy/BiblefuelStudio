import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Upload, Loader2, Download } from 'lucide-react';
import { api } from '../lib/api';
import { storyApi } from '../lib/storyApi';
import { useStoryProject } from '../hooks/useStoryProject';
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
import type { StoryProject } from '../lib/storyTypes';

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

  const onRegenerate = async (sceneId: string) => {
    if (!projectId) return;
    setBusy(true);
    try { await storyApi.regenerateScene(projectId, sceneId); refresh(); toast.success('Image regenerated'); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const onRender = async () => {
    if (!projectId) return;
    setBusy(true);
    try { await storyApi.render(projectId); refresh(); }
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

  const step = project ? deriveStep(project) : 1;
  const stalled = project ? isStalled(project, Date.now()) : false;

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

      {stalled && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <span className="text-sm text-amber-200">This project was interrupted. Pick up where it left off.</span>
          <button
            onClick={resume}
            className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-dark-900 hover:bg-amber-400"
          >
            Resume
          </button>
        </div>
      )}

      {step === 1 && (
        <div className="mt-6 space-y-4">
          {!project && (
            <ProjectHistory
              onOpen={(id) => setActive(id)}
              activeId={projectId}
              onDeleted={() => setActive(null)}
            />
          )}
          {project?.error && <ErrorBanner message={project.error} />}
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
          {project.error && <ErrorBanner message={project.error} />}
          <ImageProgress project={project} />
          {project.scenes.map((s) => (
            <SceneCard key={s.id} scene={s} onPatch={onPatch} onRegenerate={onRegenerate} busy={busy} />
          ))}
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
        </div>
      )}

      {step === 3 && project && (
        <div className="mt-6 space-y-4">
          {project.status === 'rendering' && <RenderProgressOverlay active mode="queued" />}
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

function ImageProgress({ project }: { project: StoryProject }) {
  const { done, total } = imageCounts(project.scenes);
  if (done >= total) return null;
  return (
    <div className="flex items-center gap-2 text-xs text-gray-400">
      <Loader2 className="animate-spin text-primary-400" size={14} />
      Generating images… {done}/{total}
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
