import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { thumbnailBody, type ThumbnailDesign } from '../../lib/youtubeThumbnail';

/** Typing shouldn't make a picture per keystroke. */
const DEBOUNCE_MS = 500;
/** A busy server can take a while to make one; the default 15 s is too short. */
const PREVIEW_TIMEOUT_MS = 60_000;

/**
 * The thumbnail exactly as YouTube will get it: the server makes it the same
 * way publishing does. The last good picture stays up while the next is made.
 */
export function ThumbnailPreview({ design }: { design: ThumbnailDesign }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const current = useRef<string | null>(null);
  const { path, title, withTitle, tagline } = design;

  useEffect(() => {
    if (!path) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const make = async () => {
      setLoading(true);
      const res = await api.postForBlob('/api/social/youtube/thumbnail-preview', thumbnailBody({ path, title, withTitle, tagline }), { timeout: PREVIEW_TIMEOUT_MS });
      if (cancelled) return;
      // The server makes one preview at a time; ask again once it's free.
      if (res.status === 429) { timer = setTimeout(make, DEBOUNCE_MS); return; }
      setLoading(false);
      if (!res.ok || !res.data) {
        setError(res.error || 'Couldn’t show the thumbnail');
        return;
      }
      const next = URL.createObjectURL(res.data);
      if (current.current) URL.revokeObjectURL(current.current);
      current.current = next;
      setError('');
      setSrc(next);
    };
    timer = setTimeout(make, DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [path, title, withTitle, tagline]);

  useEffect(() => () => { if (current.current) URL.revokeObjectURL(current.current); }, []);

  if (!path) return null;
  return (
    <div className="relative aspect-video w-full max-w-md overflow-hidden rounded-xl border border-[rgba(216,184,120,0.22)] bg-bf-card2">
      {src && <img src={src} alt="Thumbnail preview" className="h-full w-full object-cover" />}
      {!src && !error && <div className="flex h-full items-center justify-center text-xs text-bf-muted">Making the preview…</div>}
      {error && <div role="alert" className="flex h-full items-center justify-center p-3 text-center text-xs text-bf-danger">{error}</div>}
      {loading && src && (
        <span className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-[#fff]" aria-label="Updating preview">
          <Loader2 size={14} className="animate-spin" />
        </span>
      )}
    </div>
  );
}
