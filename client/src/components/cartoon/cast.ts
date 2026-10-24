/**
 * Who in a cartoon is ready to be filmed. Mirrors `portraitReady` and
 * `unreadyCast` in server/src/lib/cartoon/edits.js, so the Cast step's Next
 * waits for exactly the characters the server's shot-list approval would
 * name as still waiting (CAST_NOT_READY).
 */
import type { CartoonCastEntry, CartoonProject } from '../../lib/cartoonTypes';

/** A character is ready to film once a finished portrait of them is approved. */
export function portraitReady(member: CartoonCastEntry | null | undefined): boolean {
  return Boolean(member?.approved && member.portrait?.status === 'done' && member.portrait.url);
}

/** Every character (the cast plus anyone who speaks) without an approved finished portrait, in cast order. */
export function waitingCast(project: Pick<CartoonProject, 'cast' | 'shots'>): string[] {
  const cast = project.cast ?? {};
  const names = new Set(Object.keys(cast));
  for (const shot of project.shots ?? []) if (shot.speaker) names.add(shot.speaker);
  return [...names].filter((name) => !portraitReady(Object.hasOwn(cast, name) ? cast[name] : null));
}

/** "Eli", "Eli and Pip", "Eli, Pip and Naomi". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
