import type { StoryAspect } from './storyTypes';

/**
 * Tailwind classes that draw a box in a Story video's output frame, so scene
 * thumbnails and pickers show pictures in the shape the video will have.
 * Literal class names on purpose: Tailwind only generates classes it can find
 * written out in the source.
 */
export function frameBoxClass(aspect: StoryAspect | undefined): string {
  if (aspect === 'landscape') return 'aspect-video';
  if (aspect === 'square') return 'aspect-square';
  return 'aspect-[9/16]';
}

/** Thumbnail width per frame: a wider frame needs more width to stay legible. */
export function frameThumbWidthClass(aspect: StoryAspect | undefined): string {
  if (aspect === 'landscape') return 'w-32';
  if (aspect === 'square') return 'w-24';
  return 'w-20';
}

const FRAME_RATIO: Record<StoryAspect, number> = { portrait: 9 / 16, landscape: 16 / 9, square: 1 };

// Mirrors server/src/lib/story/sceneFraming.js (chooseSceneFit): your own media
// is shown whole once its shape is 15% off the frame's; a generated image keeps
// the full-bleed crop unless a crop would lose about half of it. Keep the two
// in step, so a thumbnail shows the composition the video will have.
const OWN_MEDIA_TOLERANCE = 0.15;
const GENERATED_TOLERANCE = 0.8;

export type SceneFit = 'cover' | 'contain';

/**
 * How a scene's picture will sit in the frame: 'cover' (cropped to fill) or
 * 'contain' (shown whole). Before the picture's size is known, a generated
 * image is assumed to fill (it was made for the frame) and your own is shown
 * whole.
 */
export function sceneThumbFit({ width, height, aspect, generated }: {
  width?: number; height?: number; aspect: StoryAspect | undefined; generated: boolean;
}): SceneFit {
  if (!(width && height && width > 0 && height > 0)) return generated ? 'cover' : 'contain';
  const ratio = (width / height) / FRAME_RATIO[aspect ?? 'portrait'];
  const tolerance = generated ? GENERATED_TOLERANCE : OWN_MEDIA_TOLERANCE;
  return Math.abs(Math.log(ratio)) <= Math.log(1 + tolerance) ? 'cover' : 'contain';
}
