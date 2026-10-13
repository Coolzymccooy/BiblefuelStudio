import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Download, Loader2 } from 'lucide-react';
import { lyricVideoApi } from '../../lib/lyricVideoApi';
import { lyricDownloadUrl, lyricVideoUrl } from '../../lib/lyricDownload';
import { formatSongLength } from '../../lib/lyricTiming';
import type { LyricProject, LyricRender, LyricRenderJob, RenderAspect, RenderQuality } from '../../lib/lyricVideoTypes';
import { RenderProgressOverlay } from '../RenderProgressOverlay';
import { fieldLabelCls, inputCls, panelCls, primaryBtnCls, secondaryBtnCls } from '../story/formStyles';
import { messageOf } from './messageOf';

interface Props { project: LyricProject; onChange: (p: LyricProject) => void }

const POLL_MS = 2000;
/** Failed progress checks in a row before we stop asking and say so. */
const MAX_POLL_FAILURES = 5;

const ASPECTS: Array<{ id: RenderAspect; label: string; name: string }> = [
  { id: 'portrait', label: 'Portrait 9:16 — best for Shorts and TikTok', name: 'Portrait' },
  { id: 'landscape', label: 'Landscape 16:9', name: 'Landscape' },
  { id: 'square', label: 'Square 1:1', name: 'Square' },
];
const QUALITIES: Array<{ id: RenderQuality; label: string }> = [
  { id: '720p', label: '720p' },
  { id: '1080p', label: '1080p — takes longer' },
];

const isFinished = (job: LyricRenderJob) => job.status === 'done' || job.status === 'error' || job.status === 'cancelled';
const aspectName = (id: RenderAspect) => ASPECTS.find((a) => a.id === id)?.name ?? id;

/** Asks how the video is coming along every 2 seconds until it is finished. */
function useRenderJob(projectId: string, jobId: string | null, onDone: (job: LyricRenderJob) => void) {
  // Kept with the id it belongs to, so the last video's result is never mistaken for this one's.
  const [latest, setLatest] = useState<{ id: string; job: LyricRenderJob } | null>(null);
  const [lost, setLost] = useState<{ id: string; message: string } | null>(null);
  const done = useRef(onDone);
  // Kept current in an effect so the polling loop below always calls the latest handler.
  useEffect(() => { done.current = onDone; });

  useEffect(() => {
    if (!jobId) return undefined;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const check = async () => {
      try {
        const current = await lyricVideoApi.renderStatus(projectId, jobId);
        if (stopped) return;
        failures = 0;
        setLatest({ id: jobId, job: current });
        if (isFinished(current)) {
          if (current.status === 'done') done.current(current);
          return;
        }
      } catch (e) {
        if (stopped) return;
        failures += 1;
        if (failures >= MAX_POLL_FAILURES) { setLost({ id: jobId, message: messageOf(e) }); return; }
      }
      timer = setTimeout(check, POLL_MS);
    };
    void check();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [projectId, jobId]);

  return {
    job: latest?.id === jobId ? latest.job : null,
    lostTrack: lost?.id === jobId ? lost.message : null,
  };
}

function DownloadLink({ file, title }: { file: string; title: string }) {
  return (
    <a href={lyricDownloadUrl(file, title)} className={secondaryBtnCls}>
      <Download size={16} aria-hidden /> Download
    </a>
  );
}

function EarlierRender({ render, title, onWatch }: { render: LyricRender; title: string; onWatch: () => void }) {
  const when = new Date(render.at);
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <span className="flex-1 text-content-secondary">
        {aspectName(render.aspect)} · {render.quality} · {formatSongLength(render.durationSec)}
        {Number.isNaN(when.getTime()) ? '' : ` · ${when.toLocaleDateString()}`}
      </span>
      <button type="button" className={secondaryBtnCls} onClick={onWatch}>Watch</button>
      <DownloadLink file={render.file} title={title} />
    </li>
  );
}

/** Step 5: make the video, watch it, and save it. */
export function RenderStep({ project, onChange }: Props) {
  const [aspect, setAspect] = useState<RenderAspect>('portrait');
  const [quality, setQuality] = useState<RenderQuality>('720p');
  const [starting, setStarting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const { job, lostTrack } = useRenderJob(project.projectId, jobId, (finished) => {
    if (finished.file) setShown(finished.file);
    // The finished video is now part of the project; fetch it so the list below is current.
    void lyricVideoApi.get(project.projectId).then(onChange).catch(() => undefined);
  });

  const working = starting || (jobId !== null && !lostTrack && !(job && isFinished(job)));
  const hasTimedLines = project.lines.some((l) => Array.isArray(l.words) && l.words.length > 0);

  const start = async () => {
    setStarting(true);
    setShown(null);
    setCancelling(false);
    try {
      setJobId(await lyricVideoApi.render(project.projectId, aspect, quality));
    } catch (e) {
      toast.error(messageOf(e));
    } finally {
      setStarting(false);
    }
  };

  const cancel = async () => {
    if (!jobId) return;
    setCancelling(true);
    try {
      await lyricVideoApi.cancelRender(project.projectId, jobId);
    } catch (e) {
      setCancelling(false);
      toast.error(messageOf(e));
    }
  };

  const doneJobId = job?.status === 'done' ? job.jobId : null;
  const earlier = [...project.renders]
    .filter((r) => r.jobId !== doneJobId)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const failure = lostTrack ?? (job && (job.status === 'error' || job.status === 'cancelled') ? job.error || 'The video was not made.' : null);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="lyric-frame" className={fieldLabelCls}>Frame</label>
          <select id="lyric-frame" className={inputCls} value={aspect} disabled={working} onChange={(e) => setAspect(e.target.value as RenderAspect)}>
            {ASPECTS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="lyric-quality" className={fieldLabelCls}>Quality</label>
          <select id="lyric-quality" className={inputCls} value={quality} disabled={working} onChange={(e) => setQuality(e.target.value as RenderQuality)}>
            {QUALITIES.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
          </select>
        </div>
      </div>
      {aspect !== 'portrait' && (
        <p className="text-xs text-content-secondary">
          The preview on the earlier steps is always a tall frame. Your video will be {aspect === 'landscape' ? 'wide' : 'square'}.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={primaryBtnCls} disabled={working || !hasTimedLines} onClick={start}>
          {starting && <Loader2 size={16} className="animate-spin" aria-hidden />} Render video
        </button>
        {working && jobId && (
          <button type="button" className={secondaryBtnCls} disabled={cancelling} onClick={cancel}>Cancel</button>
        )}
      </div>
      {!hasTimedLines && <p className="text-xs text-content-secondary">Time the lyrics first, then you can make the video.</p>}

      <RenderProgressOverlay
        active={working}
        progress={job?.progress}
        mode="queued"
        stage="Making your lyric video…"
        footnote="You can leave this page. Your video keeps rendering and will be here when you come back."
      />

      {failure && <p role="alert" className="text-sm text-bf-danger">{failure}</p>}

      {shown && (
        <div className={`${panelCls} space-y-3`}>
          <video key={shown} src={lyricVideoUrl(shown)} controls playsInline className="mx-auto max-h-[70vh] w-full rounded-lg bg-black" />
          <DownloadLink file={shown} title={project.title} />
        </div>
      )}

      {earlier.length > 0 && (
        <div className="space-y-2">
          <p className={fieldLabelCls}>Earlier videos</p>
          <ul className="space-y-2">
            {earlier.map((r) => (
              <EarlierRender key={r.jobId} render={r} title={project.title} onWatch={() => setShown(r.file)} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
