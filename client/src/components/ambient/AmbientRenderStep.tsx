import toast from 'react-hot-toast';
import { Download, X } from 'lucide-react';
import { api } from '../../lib/api';
import { ambientApi } from '../../lib/ambientApi';
import type { AmbientProject } from '../../lib/ambientTypes';
import { RenderProgressOverlay } from '../RenderProgressOverlay';
import { formatLength, renderEstimateMinutes } from '../../lib/ambientLength';
import { primaryBtnCls, secondaryBtnCls } from '../story/formStyles';

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
    return <AmbientDonePanel project={project} />;
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

function AmbientDonePanel({ project }: { project: AmbientProject }) {
  const token = api.getToken();
  const base = `${api.mediaBaseUrl}/outputs/ambient/${project.projectId}/video.mp4`;
  const url = token ? `${base}?token=${encodeURIComponent(token)}` : base;
  return (
    <div className="space-y-3">
      <video src={url} controls className="w-full rounded-2xl border border-[rgba(216,184,120,0.22)] shadow-lg" />
      <button onClick={() => api.downloadMedia(base, 'ambient-video.mp4')} className={primaryBtnCls}>
        <Download size={16} /> Download MP4
      </button>
    </div>
  );
}
