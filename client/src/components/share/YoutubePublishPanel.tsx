import { useState } from 'react';
import { Loader2, Youtube } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../lib/api';

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
}

export interface YoutubePublishResult {
  videoId: string;
  videoUrl: string;
  forcedPrivate: boolean;
  thumbnailError?: string;
}

export interface YoutubePublishPanelProps {
  videoUrl: string;
  initial?: Partial<YoutubePublishFields>;
  thumbnailOptions?: Array<{ label: string; path: string }>;
  chapters?: Array<{ startMs: number; title: string }>;
  /** `sent` is what was asked for, so a caller can keep a record of the upload. */
  onPublished?: (r: YoutubePublishResult, sent: { privacyStatus: YoutubePrivacy; publishAt: string }) => void;
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

export function YoutubePublishPanel({ videoUrl, initial, thumbnailOptions = [], chapters, onPublished }: YoutubePublishPanelProps) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [tagsRaw, setTagsRaw] = useState((initial?.tags ?? []).join(', '));
  const [privacy, setPrivacy] = useState<YoutubePrivacy>(initial?.privacyStatus ?? 'private');
  const [publishAtLocal, setPublishAtLocal] = useState(initial?.publishAt ?? '');
  const [thumbnailPath, setThumbnailPath] = useState(initial?.thumbnailPath ?? thumbnailOptions[0]?.path ?? '');
  const [thumbnailTitle, setThumbnailTitle] = useState(initial?.thumbnailTitle ?? false);
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState('');

  const publish = async () => {
    if (busy) return;
    if (!title.trim()) { setFieldError('Title is required'); return; }
    if (title.trim().length > 100) { setFieldError('Title must be 100 characters or fewer'); return; }
    setFieldError('');
    setBusy(true);
    try {
      const publishAt = toIsoPublishAt(publishAtLocal);
      const res = await api.post<YoutubePublishResult>('/api/social/post', {
        destination: 'youtube',
        videoUrl,
        title: title.trim(),
        description,
        tags: parseTags(tagsRaw),
        privacyStatus: privacy,
        publishAt,
        thumbnailPath,
        thumbnailTitle: Boolean(thumbnailPath) && thumbnailTitle,
        chapters,
      });
      if (!res.ok || !res.data) { toast.error(res.error || 'YouTube upload failed'); return; }
      const r = res.data;
      if (r.forcedPrivate) toast.success('Scheduled — the video stays private until its publish time.');
      else toast.success('Uploaded to YouTube');
      if (r.thumbnailError) toast.error(`Uploaded, but the thumbnail was rejected: ${r.thumbnailError}`);
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
      {fieldError && <p className="text-sm font-medium text-bf-danger">{fieldError}</p>}
      <button
        type="button"
        onClick={publish}
        disabled={busy}
        className={`${primaryBtnCls} w-full sm:w-auto`}
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Youtube size={16} />}
        Publish to YouTube
      </button>
    </div>
  );
}
