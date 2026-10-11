import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Loader2, RefreshCw, Wand2, ImageOff, SlidersHorizontal, Check, Clock, Upload, Images, Copy, Film } from 'lucide-react';
import { AuthedImage } from '../AuthedImage';
import { sceneTimeLabel } from '../../lib/storyWizard';
import type { ImageStatus, StoryScene } from '../../lib/storyTypes';
import { cleanCaptionLine } from '../../lib/speakableScript';
import { copyText } from '../../lib/copyText';

interface SceneCardProps {
  scene: StoryScene;
  /** 0-based position, shown as the gold numeral. */
  index?: number;
  onPatch: (sceneId: string, patch: { text?: string; imagePrompt?: string }) => void;
  onRegenerate: (sceneId: string) => void;
  /** A page-wide operation (bulk retry, render, etc.) is running — disable actions. */
  busy: boolean;
  /** This specific scene is mid-regenerate — only THIS card shows the spinner. */
  regenerating?: boolean;
  /** Put a photo from the device on this scene. */
  onUpload?: (sceneId: string, file: File) => void;
  /** Open the library picker for this scene. */
  onChooseFromLibrary?: (sceneId: string) => void;
  /** This scene's own picture is being uploaded. */
  uploading?: boolean;
  /** An image run is live, so a scene marked generating is really being generated. */
  imagesRunning?: boolean;
}

const STATUS: Record<ImageStatus, { label: string; cls: string }> = {
  done: { label: 'Ready', cls: 'text-bf-success' },
  generating: { label: 'Rendering', cls: 'text-bf-gold' },
  pending: { label: 'Queued', cls: 'text-bf-muted' },
  error: { label: 'Failed', cls: 'text-bf-danger' },
};

const actionCls = 'inline-flex items-center gap-1 rounded-md border border-[rgba(216,184,120,0.18)] px-2 py-1 text-xs text-bf-cream hover:border-bf-gold disabled:opacity-50';

export function SceneCard({
  scene, index = 0, onPatch, onRegenerate, busy, regenerating = false, onUpload, onChooseFromLibrary, uploading = false, imagesRunning = false,
}: SceneCardProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(scene.text);
  const [prompt, setPrompt] = useState(scene.imagePrompt);
  const [tuning, setTuning] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);

  const commitText = () => {
    const clean = cleanCaptionLine(text);
    if (clean !== text) setText(clean);
    if (clean && clean !== scene.text) onPatch(scene.id, { text: clean });
  };
  const commitPrompt = () => {
    if (prompt !== scene.imagePrompt) onPatch(scene.id, { imagePrompt: prompt });
  };

  const st = STATUS[scene.imageStatus] ?? STATUS.pending;
  const n = index + 1;
  // Without a picture, unless a live run is making it now. A cancelled run
  // leaves scenes "generating" that nothing is generating any more.
  const missing = scene.imageStatus !== 'done' && !(scene.imageStatus === 'generating' && imagesRunning);
  const yours = scene.imageStatus === 'done' && scene.imageChosenByUser;
  // Your own clip: imageUrl is its poster, so the thumbnail below still works.
  const isVideo = scene.imageStatus === 'done' && scene.mediaKind === 'video';
  const imageLocked = busy || regenerating || uploading;

  const copyPrompt = async () => {
    // What the editor shows: an edit may still be saving.
    if (await copyText(prompt)) toast.success(`Scene ${n} prompt copied`);
    else toast.error('Could not copy. Select the prompt text instead.');
  };

  // Your own picture: from the device, or one already in your library.
  const ownImageButtons = (onUpload || onChooseFromLibrary) && (
    <>
      {onUpload && (
        <button type="button" onClick={() => fileRef.current?.click()} disabled={imageLocked}
          aria-label={`Upload image or video for scene ${n}`} className={actionCls}>
          {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
          {uploading ? 'Uploading…' : 'Upload image or video'}
        </button>
      )}
      {onChooseFromLibrary && (
        <button type="button" onClick={() => onChooseFromLibrary(scene.id)} disabled={imageLocked}
          aria-label={`Choose image for scene ${n} from library`} className={actionCls}>
          <Images size={12} /> From library
        </button>
      )}
    </>
  );

  return (
    <div className="rounded-bf border border-[rgba(216,184,120,0.12)] bg-bf-card p-3.5">
      <div className="flex items-start gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] text-[15px] font-semibold tabular-nums text-bf-gold"
          style={{ background: 'linear-gradient(150deg,#4a3d24,#251c10)' }}
        >
          {n}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-displaySerif text-[15px] leading-snug text-bf-cream">{scene.text}</p>
          <div className={`mt-1.5 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide ${st.cls}`}>
            {scene.imageStatus === 'generating'
              ? <Loader2 size={12} className="animate-spin" />
              : scene.imageStatus === 'done'
                ? <Check size={12} strokeWidth={3} />
                : scene.imageStatus === 'error'
                  ? <ImageOff size={12} />
                  : <Clock size={12} />}
            {yours ? 'Your image' : st.label}
          </div>
          {isVideo && (
            <span
              title="This scene plays your own video clip"
              className="ml-2 inline-flex items-center gap-1 rounded-full border border-[rgba(216,184,120,0.3)] px-1.5 py-px align-middle text-[10px] font-semibold uppercase tracking-wide text-bf-gold"
            >
              <Film size={10} aria-hidden /> Video
            </span>
          )}
          {missing && !tuning && ownImageButtons && <div className="mt-2 flex flex-wrap gap-2">{ownImageButtons}</div>}
        </div>
        <button
          type="button"
          onClick={() => setTuning((v) => !v)}
          aria-label="Tune scene"
          className={`shrink-0 rounded-lg p-1.5 transition-colors ${tuning ? 'bg-[rgba(216,184,120,0.10)] text-bf-gold' : 'text-bf-muted hover:text-bf-gold'}`}
        >
          <SlidersHorizontal size={17} />
        </button>
      </div>

      {tuning && (
        <div className="mt-3 flex gap-3 border-t border-[rgba(216,184,120,0.1)] pt-3">
          <div className="w-20 shrink-0">
            <div className="aspect-[9/16] w-full overflow-hidden rounded-lg bg-[rgba(216,184,120,0.05)]">
              {scene.imageStatus === 'generating' ? (
                <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin text-bf-gold" size={18} /></div>
              ) : scene.imageStatus === 'error' || !scene.imageUrl ? (
                <div className="flex h-full flex-col items-center justify-center gap-1 p-1.5 text-center" title={scene.imageError || 'No image yet'}>
                  <ImageOff className="text-bf-muted" size={16} />
                  <span className="text-[9px] font-medium text-bf-muted">No image</span>
                </div>
              ) : (
                <AuthedImage src={scene.imageUrl} alt={scene.text} className="h-full w-full object-cover" openOnClick={false} />
              )}
            </div>
            <div className="mt-1 text-center text-[10px] tabular-nums text-bf-muted">{sceneTimeLabel(scene)}</div>
          </div>

          <div className="min-w-0 flex-1">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={commitText}
              aria-label="Scene caption"
              className="w-full rounded-md border border-[rgba(216,184,120,0.14)] bg-bf-input px-2 py-1.5 text-sm text-bf-cream focus:border-[rgba(216,184,120,0.4)] focus:outline-none"
            />
            <button type="button" onClick={() => setShowPrompt((v) => !v)} className="mt-2 text-xs text-bf-muted hover:text-bf-gold">
              {showPrompt ? 'Hide prompt' : 'Edit image prompt'}
            </button>
            {showPrompt && (
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onBlur={commitPrompt}
                aria-label="Image prompt"
                rows={3}
                className="mt-1 w-full rounded-md border border-[rgba(216,184,120,0.14)] bg-bf-input px-2 py-1.5 text-xs text-bf-sub focus:border-[rgba(216,184,120,0.4)] focus:outline-none"
              />
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onRegenerate(scene.id)}
                disabled={imageLocked}
                className={actionCls}
              >
                {regenerating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {regenerating ? 'Regenerating…' : 'Regenerate'}
              </button>
              {ownImageButtons}
              <button type="button" onClick={copyPrompt} aria-label={`Copy image prompt for scene ${n}`} className={actionCls}>
                <Copy size={12} /> Copy prompt
              </button>
              {scene.promptEditedByUser && (
                <span className="inline-flex items-center gap-1 text-[10px] text-bf-goldDeep"><Wand2 size={10} /> edited</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Pictures are JPEG/PNG/WebP only: listing the image types explicitly
          makes iOS hand over a JPEG instead of a HEIC, which prod's ffmpeg
          cannot decode. Video clips (a Pixabay download, say) are MP4, MOV
          or WebM; the server checks each one and gives it a poster. */}
      {onUpload && (
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm"
          aria-label={`Image or video file for scene ${n}`}
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(scene.id, f); e.target.value = ''; }}
        />
      )}
    </div>
  );
}
