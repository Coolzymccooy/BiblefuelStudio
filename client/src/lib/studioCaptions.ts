/**
 * Studio caption looks (the server's libass engine): shared ids, labels and
 * seed helpers for every caption picker.
 */

export interface StudioOption { id: string; label: string; description?: string }

export type CaptionEnergy = 'calm' | 'lively' | 'wild';

export const STUDIO_PREFIX = 'studio-';
export const SEED_MAX = 2147483647;

/** Used until (or if) the server's energy list loads. */
export const FALLBACK_ENERGIES: StudioOption[] = [
  { id: 'calm', label: 'Calm' },
  { id: 'lively', label: 'Lively' },
  { id: 'wild', label: 'Wild' },
];

export const isStudioLook = (id?: string | null): boolean =>
  typeof id === 'string' && id.startsWith(STUDIO_PREFIX);

/** "studio-lagos-night" -> "lagos-night"; any other id is returned unchanged. */
export const lookSlug = (id: string): string =>
  id.startsWith(STUDIO_PREFIX) ? id.slice(STUDIO_PREFIX.length) : id;

/** "studio-lagos-night" -> "Lagos Night". */
export const readableLook = (id: string): string =>
  lookSlug(id)
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

/** A new random seed that is never the current one, so Shuffle always changes something. */
export function nextSeed(current?: number, random: () => number = Math.random): number {
  const next = Math.floor(random() * SEED_MAX);
  return next === current ? (next + 1) % SEED_MAX : next;
}

export const randomSeed = (): number => Math.floor(Math.random() * SEED_MAX);
