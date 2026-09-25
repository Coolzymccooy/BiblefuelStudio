import { useEffect, useRef, useState } from 'react';
import { Loader2, Youtube } from 'lucide-react';
import toast from 'react-hot-toast';
import { publishToYoutube } from '../../lib/youtubePublish';
import { ThumbnailPreview } from './ThumbnailPreview';
import { chapterPreviewLines } from '../../lib/youtubeChapters';
import type { ThumbnailDesign } from '../../lib/youtubeThumbnail';
import { ApplyThumbnail, type ExistingVideo } from './ApplyThumbnail';

export type YoutubePrivacy = 'private' | 'unlisted' | 'public';

export interface YoutubePublishFields {
  title: string;
  description: string;
  tags: string[];
  privacyStatus: YoutubePrivacy;
  publishAt: string;
  thumbnailPath: string;
  /** Draw the title onto the thumbnail (the server makes the image). */
  thumbnailTitle: boolean;
  /** A small line above the title on the thumbnail, e.g. "2 hours · soaking worship". */
  thumbnailTagline: string;
}

export interface YoutubePublishResult {
  videoId: string;
  videoUrl: string;
  forcedPrivate: boolean;
  thumbnailError?: string;
  /** The picture went up, but without the title that was asked for. */
  thumbnailWarning?: string;
  /** With `record`: whether the server noted the video on that session. */
  recorded?: boolean;
}

export interface YoutubePublishPanelProps {
  videoUrl: string;
  initial?: Partial<YoutubePublishFields>;
  thumbnailOptions?: Array<{ label: string; path: string }>;
  chapters?: Array<{ startMs: number; title: string }>;
  /** Videos this came from already on YouTube, which can take the thumbnail too. */
  existingVideos?: ExistingVideo[];
  /** `sent` is what was asked for, so a caller can keep a record of the upload. */
  onPublished?: (r: YoutubePublishResult, sent: { privacyStatus: YoutubePrivacy; publishAt: string }) => void;
  /**
   * Have the server note the finished upload on this ambient session itself,
   * so the history is right even if the page is closed mid-upload.
   */
  record?: { ambientProjectId: string };
}

import { fieldLabelCls, inputCls, primaryBtnCls } from '../story/formStyles';

export function parseTags(raw: string): string[] {
  return raw.split(',').map((t) => t.trim()).filter(Boolean);
}

/** datetime-local gives a local wall-clock string; YouTube wants an ISO instant. */
export function toIsoPublishAt(local: string): string {
  if (!local) return '';
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

export function YoutubePublishPanel({ videoUrl, initial, thumbnailOptions = [], chapters, existingVideos = [], onPublished, record }: YoutubePublishPanelProps) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [tagsRaw, setTagsRaw] = useState((initial?.tags ?? []).join(', '));
  const [privacy, setPrivacy] = useState<YoutubePrivacy>(initial?.privacyStatus ?? 'private');
  const [publishAtLocal, setPublishAtLocal] = useState(initial?.publishAt ?? '');
  const [thumbnailPath, setThumbnailPath] = useState(initial?.thumbnailPath ?? thumbnailOptions[0]?.path ?? '');
  const [thumbnailTitle, setThumbnailTitle] = useState(initial?.thumbnailTitle ?? false);
  const [tagline, setTagline] = useState(initial?.thumbnailTagline ?? '');
  const [busy, setBusy] = useState(false);
  // Leaving the page stops following the upload, never the upload itself.
  const gone = useRef(false);
  useEffect(() => { gone.current = false; return () => { gone.current = true; }; }, []);
  const [fieldError, setFieldError] = useState('');

  const design: ThumbnailDesign = { path: thumbnailPath, title: title.trim(), withTitle: thumbnailTitle, tagline };

  const publish = async () => {
    if (busy) return;
    if (!title.trim()) { setFieldError('Title is required'); return; }
    if (title.trim().length > 100) { setFieldError('Title must be 100 characters or fewer'); return; }
    setFieldError('');
    setBusy(true);
    try {
      const publishAt = toIsoPublishAt(publishAtLocal);
      const res = await publishToYoutube({
        videoUrl,
        title: title.trim(),
        description,
        tags: parseTags(tagsRaw),
        privacyStatus: privacy,
        publishAt,
        thumbnailPath,
        thumbnailTitle: Boolean(thumbnailPath) && thumbnailTitle,
        thumbnailTagline: thumbnailPath && thumbnailTitle ? tagline.trim() : '',
        chapters,
        ...(record ? { record } : {}),
      }, { shouldStop: () => gone.current });
      if (!res.ok) {
        if ('error' in res) toast.error(res.error);
        return;
      }
      const r = res.result;
      if (r.forcedPrivate) toast.success('Scheduled — the video stays private until its publish time.');
      else toast.success('Uploaded to YouTube');
      if (r.thumbnailError) toast.error(`Uploaded, but the thumbnail was rejected: ${r.thumbnailError}`);
      else if (r.thumbnailWarning) toast(r.thumbnailWarning, { icon: '⚠️', duration: 8000 });
      onPublished?.(r, { privacyStatus: privacy, publishAt });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <label className={fieldLabelCls}>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} className={inputCls} />
      </label>
      <label className={fieldLabelCls}>
        Description
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className={inputCls} />
        {chapters && chapters.length > 0 && (
          // Chapters are appended server-side at publish time (see social.js →
          // buildYoutubeDescription), so the user only ever edits the summary.
          <span className="field-help block font-normal">
            {chapters.length} chapter timestamps will be added below this description when you publish.
          </span>
        )}
      </label>
      {chapters && chapters.length > 0 && (
        <details className="rounded-lg border border-[rgba(216,184,120,0.18)] bg-bf-card2 px-3 py-2 text-sm">
          <summary className="cursor-pointer text-bf-sub">See the timeline</summary>
          <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap font-sans text-xs leading-relaxed text-bf-cream">{chapterPreviewLines(chapters).join('\n')}</pre>
        </details>
      )}
      <label className={fieldLabelCls}>
        Tags (comma separated)
        <input value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} className={inputCls} />
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={fieldLabelCls}>
          Privacy
          <select value={privacy} onChange={(e) => setPrivacy(e.target.value as YoutubePrivacy)} className={inputCls}>
            <option value="private">Private</option>
            <option value="unlisted">Unlisted</option>
            <option value="public">Public</option>
          </select>
        </label>
        <label className={fieldLabelCls}>
          Publish at (optional)
          <input type="datetime-local" value={publishAtLocal} onChange={(e) => setPublishAtLocal(e.target.value)} className={inputCls} />
        </label>
      </div>
      {thumbnailOptions.length > 0 && (
        <label className={fieldLabelCls}>
          Thumbnail
          <select value={thumbnailPath} onChange={(e) => setThumbnailPath(e.target.value)} className={inputCls}>
            {thumbnailOptions.map((o) => <option key={o.path} value={o.path}>{o.label}</option>)}
          </select>
        </label>
      )}
      {thumbnailOptions.length > 0 && (
        <label className="flex items-center gap-2 text-sm text-content-secondary">
          <input type="checkbox" checked={thumbnailTitle} onChange={(e) => setThumbnailTitle(e.target.checked)} />
          Put the title on the thumbnail
        </label>
      )}
      {thumbnailOptions.length > 0 && thumbnailTitle && (
        <label className={fieldLabelCls}>
          Line above the title (optional)
          <input value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={60} placeholder="2 hours · soaking worship" className={inputCls} />
        </label>
      )}
      {thumbnailOptions.length > 0 && thumbnailPath && <ThumbnailPreview design={design} />}
      {thumbnailOptions.length > 0 && <ApplyThumbnail videos={existingVideos} design={design} />}
      {fieldError && <p className="text-sm font-medium text-bf-danger">{fieldError}</p>}
      <button
        type="button"
        onClick={publish}
        disabled={busy}
        className={`${primaryBtnCls} w-full sm:w-auto`}
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Youtube size={16} />}
        {busy ? 'Uploading to YouTube…' : 'Publish to YouTube'}
      </button>
      {busy && (
        <p role="status" className="text-help">
          A long video takes a few minutes. The upload carries on if you leave this page.
        </p>
      )}
    </div>
  );
}
