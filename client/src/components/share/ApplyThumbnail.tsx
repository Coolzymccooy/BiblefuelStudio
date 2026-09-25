import { useState } from 'react';
import { ImageUp, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../lib/api';
import { fieldLabelCls, inputCls } from '../story/formStyles';
import { thumbnailBody, youtubeVideoId, type ThumbnailDesign } from '../../lib/youtubeThumbnail';

export interface ExistingVideo {
  videoId: string;
  label: string;
}

const OTHER = '__other__';

/**
 * Put the thumbnail above on a video that is already on YouTube, without
 * uploading it again: the fix for videos that went up with a bare picture.
 */
export function ApplyThumbnail({ videos, design }: { videos: ExistingVideo[]; design: ThumbnailDesign }) {
  const [choice, setChoice] = useState(videos[0]?.videoId ?? OTHER);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  if (!design.path) return null;
  // A choice that has left the list falls back to the newest video.
  const picked = choice === OTHER || videos.some((v) => v.videoId === choice) ? choice : (videos[0]?.videoId ?? OTHER);
  const videoId = picked === OTHER ? youtubeVideoId(link) : picked;

  const apply = async () => {
    if (busy || !videoId) return;
    setBusy(true);
    try {
      const res = await api.post('/api/social/youtube/thumbnail', { videoId, ...thumbnailBody(design) });
      if (res.ok) toast.success('Thumbnail updated on YouTube. It can take a few minutes to show.');
      else toast.error(res.error || 'YouTube didn’t take the thumbnail');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-[rgba(216,184,120,0.18)] bg-bf-card2 px-3 py-2">
      <div className="field-label">Already on YouTube? Give it this thumbnail</div>
      {videos.length > 0 && (
        <label className={fieldLabelCls}>
          Video
          <select value={picked} onChange={(e) => setChoice(e.target.value)} className={inputCls}>
            {videos.map((v) => <option key={v.videoId} value={v.videoId}>{v.label}</option>)}
            <option value={OTHER}>Another video (paste its link)</option>
          </select>
        </label>
      )}
      {picked === OTHER && (
        <label className={fieldLabelCls}>
          YouTube link
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" className={inputCls} />
          {link.trim() && !videoId && <span className="field-help block font-normal text-bf-danger">That isn’t a YouTube video link.</span>}
        </label>
      )}
      <button
        type="button"
        onClick={apply}
        disabled={busy || !videoId}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[rgba(216,184,120,0.3)] px-3 py-1.5 text-xs text-bf-cream transition hover:border-bf-gold disabled:cursor-not-allowed disabled:text-bf-muted"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <ImageUp size={12} />}
        {busy ? 'Updating…' : 'Update thumbnail on YouTube'}
      </button>
    </div>
  );
}
