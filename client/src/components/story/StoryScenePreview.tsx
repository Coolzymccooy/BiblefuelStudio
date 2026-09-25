import { Play } from 'lucide-react';
import { AuthedImage } from '../AuthedImage';
import type { StoryScene } from '../../lib/storyTypes';

/**
 * Cinematic preview of the "current" scene — the one being generated, else the
 * first. Shows its image (or a warm gradient placeholder), the scene index, and
 * the caption text, matching the Story Video handoff.
 */
export function StoryScenePreview({ scenes }: { scenes: StoryScene[] }) {
  if (!scenes.length) return null;

  const generatingIdx = scenes.findIndex((s) => s.imageStatus === 'generating');
  const idx = generatingIdx >= 0 ? generatingIdx : 0;
  const scene = scenes[idx];
  const hasImage = scene.imageStatus === 'done' && !!scene.imageUrl;

  return (
    <div className="relative overflow-hidden rounded-bf-lg border border-[rgba(216,184,120,0.14)]" style={{ aspectRatio: '16 / 10' }}>
      {hasImage ? (
        <AuthedImage src={scene.imageUrl ?? ''} alt={scene.text} className="absolute inset-0 h-full w-full object-cover" openOnClick={false} />
      ) : (
        <div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(120% 80% at 62% 22%, rgba(216,184,120,0.16), transparent 60%), linear-gradient(165deg,#1a130b,#0e0a06)' }}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />

      <div aria-hidden className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-bf-cream backdrop-blur-sm">
        <Play size={18} fill="currentColor" className="ml-0.5" />
      </div>

      <div className="absolute inset-x-0 bottom-0 p-5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-bf-goldDeep">
          Scene {idx + 1} / {scenes.length} · Portrait
        </div>
        <div className="mt-1.5 line-clamp-2 font-displaySerif text-[22px] italic leading-tight text-bf-cream">
          &ldquo;{scene.text}&rdquo;
        </div>
      </div>
    </div>
  );
}
