import { useState } from 'react';
import { Loader2, RefreshCw, Wand2, ImageOff } from 'lucide-react';
import { AuthedImage } from '../AuthedImage';
import { sceneTimeLabel } from '../../lib/storyWizard';
import type { StoryScene } from '../../lib/storyTypes';

interface SceneCardProps {
  scene: StoryScene;
  onPatch: (sceneId: string, patch: { text?: string; imagePrompt?: string }) => void;
  onRegenerate: (sceneId: string) => void;
  /** A page-wide operation (bulk retry, render, etc.) is running — disable actions. */
  busy: boolean;
  /** This specific scene is mid-regenerate — only THIS card shows the spinner. */
  regenerating?: boolean;
}

export function SceneCard({ scene, onPatch, onRegenerate, busy, regenerating = false }: SceneCardProps) {
  const [text, setText] = useState(scene.text);
  const [prompt, setPrompt] = useState(scene.imagePrompt);
  const [showPrompt, setShowPrompt] = useState(false);

  const commitText = () => {
    if (text !== scene.text) onPatch(scene.id, { text });
  };
  const commitPrompt = () => {
    if (prompt !== scene.imagePrompt) onPatch(scene.id, { imagePrompt: prompt });
  };

  return (
    <div className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="w-24 shrink-0">
        <div className="aspect-[9/16] w-full overflow-hidden rounded-lg bg-white/5">
          {scene.imageStatus === 'generating' ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="animate-spin text-primary-400" size={20} />
            </div>
          ) : scene.imageStatus === 'error' || !scene.imageUrl ? (
            <div
              className="flex h-full flex-col items-center justify-center gap-1 p-1.5 text-center"
              title={scene.imageError || 'No image yet'}
            >
              <ImageOff className="text-gray-500" size={16} />
              <span className="text-[9px] font-medium text-gray-400">No image yet</span>
              {scene.imageError && (
                <span className="text-[8px] leading-snug text-gray-500 line-clamp-3">{scene.imageError}</span>
              )}
            </div>
          ) : (
            <AuthedImage src={scene.imageUrl} alt={scene.text} className="h-full w-full object-cover" openOnClick={false} />
          )}
        </div>
        <div className="mt-1 text-center text-[10px] tabular-nums text-gray-500">{sceneTimeLabel(scene)}</div>
      </div>

      <div className="min-w-0 flex-1">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          aria-label="Scene caption"
          className="w-full rounded-md border border-white/10 bg-transparent px-2 py-1 text-sm text-white focus:border-primary-400 focus:outline-none"
        />

        <button
          type="button"
          onClick={() => setShowPrompt((v) => !v)}
          className="mt-2 text-xs text-gray-400 hover:text-gray-200"
        >
          {showPrompt ? 'Hide prompt' : 'Edit image prompt'}
        </button>
        {showPrompt && (
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onBlur={commitPrompt}
            aria-label="Image prompt"
            rows={3}
            className="mt-1 w-full rounded-md border border-white/10 bg-transparent px-2 py-1 text-xs text-gray-300 focus:border-primary-400 focus:outline-none"
          />
        )}

        <div className="mt-2">
          <button
            type="button"
            onClick={() => onRegenerate(scene.id)}
            disabled={busy || regenerating}
            className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-gray-200 hover:border-primary-400 disabled:opacity-50"
          >
            {regenerating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {regenerating ? 'Regenerating…' : 'Regenerate'}
          </button>
          {scene.promptEditedByUser && (
            <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-primary-300">
              <Wand2 size={10} /> edited
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
