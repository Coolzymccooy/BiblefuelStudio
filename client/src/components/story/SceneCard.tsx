import { useState } from 'react';
import { Loader2, RefreshCw, Wand2, ImageOff, SlidersHorizontal, Check, Clock } from 'lucide-react';
import { AuthedImage } from '../AuthedImage';
import { sceneTimeLabel } from '../../lib/storyWizard';
import type { ImageStatus, StoryScene } from '../../lib/storyTypes';
import { cleanCaptionLine } from '../../lib/speakableScript';

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
}

const STATUS: Record<ImageStatus, { label: string; cls: string }> = {
  done: { label: 'Ready', cls: 'text-bf-success' },
  generating: { label: 'Rendering', cls: 'text-bf-gold' },
  pending: { label: 'Queued', cls: 'text-bf-muted' },
  error: { label: 'Failed', cls: 'text-bf-danger' },
};

export function SceneCard({ scene, index = 0, onPatch, onRegenerate, busy, regenerating = false }: SceneCardProps) {
  const [text, setText] = useState(scene.text);
  const [prompt, setPrompt] = useState(scene.imagePrompt);
  const [tuning, setTuning] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);

  const commitText = () => {
    const clean = cleanCaptionLine(text);
    if (clean !== text) setText(clean);
    if (clean && clean !== scene.text) onPatch(scene.id, { text: clean });
  };
  const commitPrompt = () => { if (prompt !== scene.imagePrompt) onPatch(scene.id, { imagePrompt: prompt }); };

  const st = STATUS[scene.imageStatus] ?? STATUS.pending;

  return (
    <div className="rounded-bf border border-[rgba(216,184,120,0.12)] bg-bf-card p-3.5">
      <div className="flex items-start gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] text-[15px] font-semibold tabular-nums text-bf-gold"
          style={{ background: 'linear-gradient(150deg,#4a3d24,#251c10)' }}
        >
          {index + 1}
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
            {st.label}
          </div>
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
            <div className="mt-2">
              <button
                type="button"
                onClick={() => onRegenerate(scene.id)}
                disabled={busy || regenerating}
                className="inline-flex items-center gap-1 rounded-md border border-[rgba(216,184,120,0.18)] px-2 py-1 text-xs text-bf-cream hover:border-bf-gold disabled:opacity-50"
              >
                {regenerating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {regenerating ? 'Regenerating…' : 'Regenerate'}
              </button>
              {scene.promptEditedByUser && (
                <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-bf-goldDeep"><Wand2 size={10} /> edited</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
