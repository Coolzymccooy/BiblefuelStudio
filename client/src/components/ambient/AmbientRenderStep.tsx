import { useState } from 'react';
import toast from 'react-hot-toast';
import { Download, X, Youtube } from 'lucide-react';
import { api } from '../../lib/api';
import { ambientApi } from '../../lib/ambientApi';
import type { AmbientProject, AmbientPublished } from '../../lib/ambientTypes';
import { RenderProgressOverlay } from '../RenderProgressOverlay';
import { formatLength, renderEstimateMinutes } from '../../lib/ambientLength';
import { panelCls, primaryBtnCls, secondaryBtnCls } from '../story/formStyles';
import { YoutubePublishPanel, type YoutubePrivacy, type YoutubePublishResult } from '../share/YoutubePublishPanel';
import { publishedLabel } from '../../lib/ambientHistory';
import { ambientChapters, ambientDescription, ambientThumbnails } from '../../lib/ambientShare';

export interface AmbientRenderStepProps {
  project: AmbientProject;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  refresh: () => void;
}

export function AmbientRenderStep({ project, busy, setBusy, refresh }: AmbientRenderStepProps) {
  const renderPct = typeof project.render.percent === 'number' ? project.render.percent : undefined;
  // Assembling the bed is the first half of a render. Treated as idle, it
  // showed the Render button again, and a second click started a second render.
  const inFlight = project.status === 'assembling' || project.status === 'rendering';

  const startRender = async () => {
    setBusy(true);
    try {
      await ambientApi.render(project.projectId);
      refresh();
      toast.success('Render started — running in the background. You can leave this page.');
    } catch (e) {
      toast.error((e as Error).message || 'Failed to start render');
    } finally {
      setBusy(false);
    }
  };

  const cancelRender = async () => {
    setBusy(true);
    try {
      await ambientApi.cancel(project.projectId);
      refresh();
      toast.success('Cancelled');
    } catch (e) {
      toast.error((e as Error).message || 'Failed to cancel');
    } finally {
      setBusy(false);
    }
  };

  if (inFlight) {
    const stage = project.status === 'assembling' ? 'Building the music bed…' : 'Encoding the video…';
    const footnote = 'This runs on the server — you can leave this page and come back. '
      + `It usually takes about ${formatLength(renderEstimateMinutes(project.targetSec))} `
      + `for ${formatLength(project.targetSec / 60)}.`;
    return (
      <div className="space-y-4">
        <RenderProgressOverlay active mode="queued" progress={renderPct} stage={stage} footnote={footnote} />
        <div className="flex justify-center">
          <button onClick={cancelRender} disabled={busy} className={`${secondaryBtnCls} px-3 py-1.5 hover:border-bf-danger hover:text-bf-danger`}>
            <X size={14} /> Cancel render
          </button>
        </div>
      </div>
    );
  }

  if (project.status === 'done' && project.render.outputPath) {
    return <AmbientDonePanel project={project} refresh={refresh} />;
  }

  return (
    <div className="space-y-4">
      {project.status === 'error' && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {project.error || 'Render failed'}
        </div>
      )}
      <button onClick={startRender} disabled={busy} className={`${primaryBtnCls} w-full justify-center px-4 py-3`}>
        Render
      </button>
    </div>
  );
}

function AmbientDonePanel({ project, refresh }: { project: AmbientProject; refresh: () => void }) {
  const chapters = ambientChapters(project);
  const published = project.published ?? [];

  // The upload itself already succeeded; this only notes it in the history.
  const notePublished = async (r: YoutubePublishResult, sent: { privacyStatus: YoutubePrivacy; publishAt: string }) => {
    try {
      await ambientApi.recordPublished(project.projectId, {
        videoId: r.videoId, privacyStatus: sent.privacyStatus, publishAt: sent.publishAt || undefined,
      });
      refresh();
    } catch {
      toast.error('Uploaded, but it could not be added to this session’s history.');
    }
  };

  const token = api.getToken();
  const base = `${api.mediaBaseUrl}/outputs/ambient/${project.projectId}/video.mp4`;
  const url = token ? `${base}?token=${encodeURIComponent(token)}` : base;
  return (
    <div className="space-y-3">
      <video src={url} controls className="w-full rounded-2xl border border-[rgba(216,184,120,0.22)] shadow-lg" />
      <button onClick={() => api.downloadMedia(base, 'ambient-video.mp4')} className={primaryBtnCls}>
        <Download size={16} /> Download MP4
      </button>
      {/* The same direct uploader Story Video uses (not Postiz). It starts
          Private: nothing goes public without the operator choosing it. */}
      <div className={panelCls}>
        <div className="bf-eyebrow mb-1">Share</div>
        <h3 className="section-title mb-3">Publish to YouTube</h3>
        {published.length > 0 && <PublishedBefore published={published} />}
        <YoutubePublishPanel
          videoUrl={`/outputs/ambient/${project.projectId}/video.mp4`}
          // A calm picture with its title is what these channels' thumbnails
          // look like; the operator can untick it.
          initial={{ title: project.title, description: ambientDescription(project), thumbnailTitle: true }}
          thumbnailOptions={ambientThumbnails(project)}
          chapters={chapters.length >= 3 ? chapters : undefined}
          onPublished={notePublished}
        />
      </div>
    </div>
  );
}

/** Where this video already went. Publishing again is allowed, and says what it does. */
function PublishedBefore({ published }: { published: AmbientPublished[] }) {
  const [now] = useState(() => Date.now());
  const newestFirst = [...published].reverse();
  return (
    <div className="mb-4 rounded-xl border border-[rgba(216,184,120,0.18)] bg-bf-card2/40 px-3 py-2">
      <div className="field-label mb-1">Already on YouTube</div>
      <ul className="space-y-1">
        {newestFirst.map((entry) => (
          <li key={`${entry.videoId}-${entry.at}`}>
            <a
              href={entry.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-bf-goldDim hover:text-bf-cream hover:underline"
            >
              <Youtube size={14} /> {publishedLabel(entry, now)}
            </a>
          </li>
        ))}
      </ul>
      <p className="field-help mt-2">
        Publishing again uploads a new copy: a separate YouTube video with its own link, views and comments.
      </p>
    </div>
  );
}
