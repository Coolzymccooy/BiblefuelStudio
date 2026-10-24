/**
 * Pure rules behind the Shots step, kept in step with the server so the list
 * shows what will really be ordered:
 *
 *  - `referencedCast` mirrors `referencedCast` in
 *    server/src/lib/cartoon/prompts.js (the server does not send it before a
 *    shot is ordered): a new-angle shot sends the approved portraits of the
 *    speaker first, then the rest of the scene in order of first appearance,
 *    at most three. A continuing shot sends none.
 *  - `asOrdered` / `canChain` mirror shotPictures.js: the first shot of the
 *    film has no shot before it, so it is always a new angle.
 *  - `shotPriceUsd` prices a shot at the rate the server's own estimate
 *    implies (its dollars over its seconds; the clip price is linear in
 *    seconds), so no price constant lives in the client.
 */
import type { CartoonEstimate, CartoonProject, CartoonShot } from '../../lib/cartoonTypes';

/** Most reference pictures one shot is sent with (MAX_REFERENCES on the server). */
export const MAX_REFERENCES = 3;
/** Longest director's note the server keeps (MAX_NOTE_CHARS in edits.js). */
export const MAX_NOTE_CHARS = 300;

type Facts = Pick<CartoonProject, 'cast' | 'scenes' | 'shots'>;

/** Whether the shot at `index` may start from the last frame of the shot before it. */
export const canChain = (index: number) => index > 0;

/** The shot as it is ordered: the film's first shot is always a new angle. */
export function asOrdered(shot: CartoonShot, index: number): CartoonShot {
  return shot.firstFrame === 'chain' && canChain(index) ? shot : { ...shot, firstFrame: 'fresh' };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Where `name` first appears in `text` as a whole word (any case), or -1. */
function wholeWordIndex(text: string, name: string): number {
  if (!text || !name) return -1;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(name)}(?![\\p{L}\\p{N}_])`, 'iu');
  const match = pattern.exec(text);
  return match ? match.index : -1;
}

/** Cast names found in `text`, in the order they appear. */
function namesIn(text: string, castNames: string[]): string[] {
  return castNames
    .map((name, order) => ({ name, order, at: wholeWordIndex(text, name) }))
    .filter((hit) => hit.at >= 0)
    .sort((a, b) => a.at - b.at || a.order - b.order)
    .map((hit) => hit.name);
}

/** Every character in the shot's scene: names in the place and note, then each shot's speaker and action. */
function sceneMembers(project: Facts, shot: CartoonShot): string[] {
  const castNames = Object.keys(project.cast ?? {});
  const scene = (project.scenes ?? []).find((s) => s.id === shot.sceneId);
  const stored = project.shots ?? [];
  const current = stored.some((s) => s.id === shot.id) ? stored.map((s) => (s.id === shot.id ? shot : s)) : [...stored, shot];
  const ordered = namesIn(`${scene?.place ?? ''} ${scene?.note ?? ''}`, castNames);
  for (const sceneShot of current.filter((s) => s.sceneId === shot.sceneId)) {
    if (sceneShot.speaker && castNames.includes(sceneShot.speaker)) ordered.push(sceneShot.speaker);
    ordered.push(...namesIn(sceneShot.action ?? '', castNames));
  }
  return [...new Set(ordered)];
}

/** Names whose approved portraits a new-angle shot is sent with: speaker first, at most three. */
export function referencedCast(project: Facts, shot: CartoonShot): string[] {
  if (shot.firstFrame !== 'fresh') return [];
  const cast = project.cast ?? {};
  const usable = (name: string) => Object.hasOwn(cast, name) && Boolean(cast[name]?.approved && cast[name]?.portrait);
  const speaker = shot.speaker ? [shot.speaker] : [];
  return [...new Set([...speaker, ...sceneMembers(project, shot)])].filter(usable).slice(0, MAX_REFERENCES);
}

/**
 * What a shot costs: a finished clip's own cost, otherwise its seconds at the
 * estimate's rate. Null when the estimate has no seconds to take a rate from.
 */
export function shotPriceUsd(estimate: Pick<CartoonEstimate, 'seconds' | 'usd'>, shot: CartoonShot): number | null {
  if (shot.clip?.status === 'done' && typeof shot.clip.costUsd === 'number') return shot.clip.costUsd;
  if (!(estimate.seconds > 0)) return null;
  return shot.seconds * (estimate.usd / estimate.seconds);
}
