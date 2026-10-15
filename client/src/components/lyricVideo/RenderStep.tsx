import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Download, Loader2 } from 'lucide-react';
import { lyricVideoApi } from '../../lib/lyricVideoApi';
import { lyricDownloadUrl, lyricVideoUrl } from '../../lib/lyricDownload';
import { formatSongLength } from '../../lib/lyricTiming';
import { ASPECTS, aspectName } from '../../lib/lyricRenderOptions';
import { shortsTrimOffer } from '../../lib/shortsTrim';
import type { LyricProject, LyricPublishDraft, LyricRender, LyricRenderJob, RenderAspect, RenderQuality } from '../../lib/lyricVideoTypes';
import { YoutubePublishPanel } from '../share/YoutubePublishPanel';
import { RenderProgressOverlay } from '../RenderProgressOverlay';
import { checkboxCls, fieldLabelCls, inputCls, panelCls, primaryBtnCls, secondaryBtnCls } from '../story/formStyles';
import { messageOf } from './messageOf';
import { BrandingOptions } from './BrandingOptions';

interface Props { project: LyricProject; onChange: (p: LyricProject) => void }

const POLL_MS = 2000;
/** Failed progress checks in a row before we stop asking and say so. */
const MAX_POLL_FAILURES = 5;

const QUALITIES: Array<{ id: RenderQuality; label: string }> = [
  { id: '720p', label: '720p' },
  { id: '1080p', label: '1080p — takes longer' },
];

const isFinished = (job: LyricRenderJob) => job.status === 'done' || job.status === 'error' || job.status === 'cancelled';

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

/** Cuts a 3:00 to 3:10 portrait song to 2:59 so it counts as a Short; refused, with the reason, when it would cut a line. */
function ShortsTrimOption({ offer, checked, disabled, onChange }: {
  offer: ReturnType<typeof shortsTrimOffer>; checked: boolean; disabled: boolean; onChange: (on: boolean) => void;
}) {
  const reasonId = 'lyric-trim-reason';
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-2 text-sm text-content-secondary">
        <input
          type="checkbox"
          className={checkboxCls}
          checked={checked}
          disabled={disabled || !offer.allowed}
          aria-describedby={offer.allowed ? undefined : reasonId}
          onChange={(e) => onChange(e.target.checked)}
        />
        Trim to 2:59 so it counts as a Short
      </label>
      {!offer.allowed && <p id={reasonId} className="ml-6 text-xs text-content-secondary">{offer.reason}</p>}
    </div>
  );
}

// YouTube's Music category, used if the draft could not be fetched.
const MUSIC_CATEGORY = '10';

/** The publish uploader finds a finished video by its name in the user's outputs. */
const outputsPath = (file: string) => `/outputs/${file.split(/[\\/]/).pop()}`;

/** Publishes the video being watched, opened with a title, description and tags made from the song. */
function PublishToYoutube({ project, file }: { project: LyricProject; file: string }) {
  const [draft, setDraft] = useState<LyricPublishDraft | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [draftFailed, setDraftFailed] = useState(false);
  // The button that opened the panel is gone once it opens, so focus moves to the panel's heading.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (open) heading.current?.focus(); }, [open]);

  const show = async () => {
    setLoading(true);
    try {
      setDraft(await lyricVideoApi.publishDraft(project.projectId));
    } catch {
      // The panel still opens, with the song's title to start from.
      setDraftFailed(true);
    } finally {
      setLoading(false);
      setOpen(true);
    }
  };

  if (!open) {
    return (
      <button type="button" className={secondaryBtnCls} disabled={loading} aria-busy={loading} onClick={show}>
        {loading && <Loader2 size={16} className="animate-spin" aria-hidden />} Publish to YouTube
      </button>
    );
  }
  return (
    <div className="space-y-3 border-t border-[rgba(216,184,120,0.14)] pt-3">
      <h3 ref={heading} tabIndex={-1} className="section-title">Publish to YouTube</h3>
      {draftFailed && <p role="status" className="text-xs text-content-secondary">The details could not be filled in for you. Type them below.</p>}
      <YoutubePublishPanel
        videoUrl={outputsPath(file)}
        initial={draft ? { title: draft.title, description: draft.description, tags: draft.tags } : { title: project.title }}
        categoryId={draft?.categoryId ?? MUSIC_CATEGORY}
      />
      {draft?.note && <p className="text-xs text-content-secondary">{draft.note}</p>}
    </div>
  );
}

/** Step 5: make the video, watch it, save it, and publish it. */
export function RenderStep({ project, onChange }: Props) {
  const [aspect, setAspect] = useState<RenderAspect>('portrait');
  const [quality, setQuality] = useState<RenderQuality>('720p');
  const [trim, setTrim] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startedJobId, setJobId] = useState<string | null>(null);
  // A render started before the user left this page is saved on the project: follow it again.
  const jobId = startedJobId ?? project.render?.activeJobId ?? null;
  const [shown, setShown] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const { job, lostTrack } = useRenderJob(project.projectId, jobId, (finished) => {
    if (finished.file) setShown(finished.file);
    // The finished video is now part of the project; fetch it so the list below is current.
    void lyricVideoApi.get(project.projectId).then(onChange).catch(() => undefined);
  });

  const working = starting || (jobId !== null && !lostTrack && !(job && isFinished(job)));
  const trimOffer = shortsTrimOffer(project, aspect);
  const hasTimedLines = project.lines.some((l) => Array.isArray(l.words) && l.words.length > 0);

  const start = async () => {
    setStarting(true);
    setShown(null);
    setCancelling(false);
    try {
      setJobId(await lyricVideoApi.render(project.projectId, aspect, quality, trim && trimOffer.allowed));
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
          <select id="lyric-frame" className={inputCls} value={aspect} disabled={working} onChange={(e) => { setAspect(e.target.value as RenderAspect); setTrim(false); }}>
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
      {trimOffer.offered && <ShortsTrimOption offer={trimOffer} checked={trim} disabled={working} onChange={setTrim} />}
      {aspect !== 'portrait' && (
        <p className="text-xs text-content-secondary">
          The preview on the earlier steps is always a tall frame. Your video will be {aspect === 'landscape' ? 'wide' : 'square'}.
        </p>
      )}

      <BrandingOptions project={project} disabled={working} onChange={onChange} />

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
          {/* Keyed by the video, so watching another one starts its own draft. */}
          <PublishToYoutube key={shown} project={project} file={shown} />
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
