/**
 * Pure rules behind the Film and Finish steps, kept in step with the server
 * (server/src/lib/cartoon/filmStage.js, renderStage.js) so the page says what
 * really happened to each paid clip:
 *
 *  - `clipStatusLabel` names a clip's state. "waiting" always waits for the
 *    shot just before it (a chained shot waits for its parent's last frame).
 *  - `retryShotIds` is what one Retry re-orders: the failed and refused
 *    shots, then the shots waiting on them (spec section 7.6). Done shots are
 *    never in it; re-making one is its own priced button.
 *  - `rateUsdPerSec` reads the price per second off a server estimate, so
 *    no clip price constant lives in the client.
 *  - `postCaption` is the post text: the title, the verse and its reference.
 */
import type { CartoonClip, CartoonEstimate, CartoonMonth, CartoonProject, CartoonShot } from '../../lib/cartoonTypes';

/** States a clip settles in without a run going: the shot needs an order to move on. */
const UNFINISHED = new Set(['error', 'refused', 'waiting']);

/** The clip is on its way: queued for ordering or being made by BytePlus. */
export const isInFlight = (clip: CartoonClip | null | undefined) => clip?.status === 'queued' || clip?.status === 'generating';

export const isDone = (shot: CartoonShot) => shot.clip?.status === 'done';

/** A shot's clip state in words; `index` is the shot's place in the film, from 0. */
export function clipStatusLabel(shot: CartoonShot, index: number): string {
  switch (shot.clip?.status) {
    case 'queued': return 'Queued';
    case 'generating': return 'Making';
    case 'waiting': return index > 0 ? `Waiting for shot ${index}` : 'Waiting';
    case 'done': return 'Done';
    case 'refused': return 'Refused';
    case 'error': return 'Failed';
    default: return 'Not made yet';
  }
}

/** Shots one Retry re-orders, in film order: failed, refused and those waiting on them. */
export function retryShotIds(shots: CartoonShot[]): string[] {
  const failed = shots.some((s) => s.clip?.status === 'error' || s.clip?.status === 'refused');
  if (!failed) return [];
  return shots.filter((s) => UNFINISHED.has(s.clip?.status ?? '')).map((s) => s.id);
}

/** Dollars per second of clip from an estimate, or null when it covers no seconds. */
export function rateUsdPerSec(estimate: Pick<CartoonEstimate, 'seconds' | 'usd'> | null | undefined): number | null {
  if (!estimate || !(estimate.seconds > 0)) return null;
  return estimate.usd / estimate.seconds;
}

/** What ordering these shots again would cost at `rate`, or null without a rate. */
export function priceOfShots(shots: CartoonShot[], rate: number | null): number | null {
  if (rate === null) return null;
  return shots.reduce((sum, s) => sum + s.seconds * rate, 0);
}

/** What is left of the monthly AI video cap, counting open reservations. */
export function monthLeftUsd(month: CartoonMonth | null | undefined): number | null {
  if (!month || !Number.isFinite(month.capUsd)) return null;
  return Math.max(0, month.capUsd - (Number(month.spentUsd) || 0) - (Number(month.reservedUsd) || 0));
}

/** Seconds without a trailing ".0". */
export const secs = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** The post text: the title, then the verse and its reference. */
export function postCaption(project: Pick<CartoonProject, 'meta'>): string {
  const { title, verse } = project.meta;
  const text = verse.text.trim();
  const reference = verse.reference.trim();
  const verseLine = text ? `“${text}”${reference ? `\n${reference}` : ''}` : reference;
  return [title.trim(), verseLine].filter(Boolean).join('\n\n');
}

/** Poster frames of the finished clips, in shot order, for the YouTube thumbnail. */
export function posterOptions(shots: CartoonShot[]): { label: string; path: string }[] {
  return shots.flatMap((s, i) => (s.clip?.status === 'done' && s.clip.posterUrl ? [{ label: `Shot ${i + 1}`, path: s.clip.posterUrl }] : []));
}
