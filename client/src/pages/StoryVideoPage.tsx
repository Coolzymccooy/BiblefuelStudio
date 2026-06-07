import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Upload, Loader2, Download } from 'lucide-react';
import { api } from '../lib/api';
import { storyApi } from '../lib/storyApi';
import { useStoryProject } from '../hooks/useStoryProject';
import {
  deriveStep, progressLabel, canRender, imageCounts, isTransientStatus,
} from '../lib/storyWizard';
import { StylePicker } from '../components/story/StylePicker';
import { SceneCard } from '../components/story/SceneCard';
import { RenderProgressOverlay } from '../components/RenderProgressOverlay';
import type { StoryProject } from '../lib/storyTypes';

const ACTIVE_KEY = 'BF_STORY_ACTIVE';

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function StoryVideoPage() {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState<string | null>(() => localStorage.getItem(ACTIVE_KEY));
  const [title, setTitle] = useState('');
  const [style, setStyle] = useState('cinematic-bible');
  const [busy, setBusy] = useState(false);

  const { data: project } = useStoryProject(projectId);
  const refresh = () => { if (projectId) qc.invalidateQueries({ queryKey: ['story-project', projectId] }); };

  const setActive = (id: string | null) => {
    setProjectId(id);
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  };

  const handleCreateAndUpload = async (file: File) => {
    setBusy(true);
    try {
      const created = await storyApi.createProject(title || file.name.replace(/\.[^.]+$/, ''), style);
      setActive(created.projectId);
      const dataUrl = await readFileAsDataUrl(file);
      const mediaPath = await storyApi.uploadAudio(dataUrl, file.name);
      await storyApi.transcribe(created.projectId, mediaPath);
      await storyApi.segment(created.projectId);
      await storyApi.generateImages(created.projectId);
      refresh();
      toast.success('Scenes ready — review below');
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

  const step = project ? deriveStep(project) : 1;
  const transient = project ? isTransientStatus(project.status) : false;

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

      {step === 1 && (
        <div className="mt-6 space-y-4">
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

          {transient ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 flex items-center gap-3 text-sm text-gray-300">
              <Loader2 className="animate-spin text-primary-400" size={18} />
              {progressLabel(project!.status)}
            </div>
          ) : (
            <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 bg-white/[0.02] px-4 py-8 text-sm text-gray-300 hover:border-primary-400 ${busy ? 'pointer-events-none opacity-60' : ''}`}>
              {busy ? <Loader2 className="animate-spin" size={18} /> : <Upload size={18} />}
              {busy ? 'Working…' : 'Upload a sermon (MP3/M4A/MP4)'}
              <input
                type="file"
                accept="audio/*,video/*"
                className="hidden"
                disabled={busy}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCreateAndUpload(f); }}
              />
            </label>
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
