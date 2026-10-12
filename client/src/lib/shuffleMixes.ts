/**
 * Which effect mix each caption look + seed is on, kept for the session so the
 * "New effect mix" line survives switching tools (inactive panels unmount).
 * Mix 1 is the original; each saved shuffle adds one.
 */
export type ShuffleSeed = number | string | null | undefined;

const MIXES = new Map<string, number>();

const keyOf = (look: string, seed: ShuffleSeed) => `${look}|${seed ?? ''}`;

/** The mix this look + seed is on (1 when it was never shuffled). */
export function mixFor(look: string, seed: ShuffleSeed): number {
  return MIXES.get(keyOf(look, seed)) ?? 1;
}

/** A shuffle landed: the new seed is one mix on from the seed it replaced. Idempotent. */
export function recordShuffle(look: string, fromSeed: ShuffleSeed, toSeed: ShuffleSeed): void {
  MIXES.set(keyOf(look, toSeed), mixFor(look, fromSeed) + 1);
}

/** Test-only: forget every recorded mix. */
export function resetShuffleMixesForTests(): void {
  MIXES.clear();
}
