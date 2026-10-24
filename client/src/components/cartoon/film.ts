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
 *    no clip price constant lives in the client. `priceOfShots` prices a
 *    paid clip that is only fetched again at $0, as the server does.
 *  - `postCaption` is the post text: the title, the verse and its reference.
 */
import type { CartoonClip, CartoonEstimate, CartoonMonth, CartoonProject, CartoonShot } from '../../lib/cartoonTypes';
import { money } from '../sceneScript/format';

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

/** BytePlus keeps a finished clip for 24 h; the server fetches a paid clip again for 23 h (REFETCH_MS in shotStage.js). */
const REFETCH_MS = 23 * 60 * 60 * 1000;

type RefetchFields = Pick<CartoonClip, 'taskId' | 'chargedTaskId' | 'startedAt' | 'refetchable'>;

function clipCanRefetch(clip: RefetchFields | null | undefined, now: number): boolean {
  return Boolean(clip?.taskId) && clip?.chargedTaskId === clip?.taskId && clip?.refetchable !== false
    && now - (Number(clip?.startedAt) || 0) < REFETCH_MS;
}

/**
 * Whether ordering this shot only fetches a clip already paid for, at no cost.
 * Mirrors `fetchesAgain` in server/src/lib/cartoon/model.js: a failed clip
 * whose download failed, or a done shot's paid re-make that was not downloaded.
 */
export function fetchesAgain(shot: CartoonShot, now = Date.now()): boolean {
  const clip = shot.clip;
  if (clip?.status === 'done') return clipCanRefetch(clip.remake, now);
  return clip?.status === 'error' && clipCanRefetch(clip, now);
}

/**
 * What ordering these shots again would cost at `rate`: a paid clip fetched
 * again is free. Null when something must be paid for and there is no rate.
 */
export function priceOfShots(shots: CartoonShot[], rate: number | null, now = Date.now()): number | null {
  const paid = shots.filter((s) => !fetchesAgain(s, now));
  if (!paid.length) return 0;
  if (rate === null) return null;
  return paid.reduce((sum, s) => sum + s.seconds * rate, 0);
}

/** A price in words: "no charge" for a free re-fetch, else "about $x". */
export const priceWords = (usd: number) => (usd === 0 ? 'no charge' : `about ${money(usd)}`);

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
