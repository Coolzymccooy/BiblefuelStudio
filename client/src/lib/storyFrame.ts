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
