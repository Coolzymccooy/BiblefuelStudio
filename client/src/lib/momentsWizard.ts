import type { DetailField, MomentMeta, MomentPhoto, MomentProject } from './momentsTypes';

const SEED_MAX = 2147483647;

export const DETAIL_LABELS: Record<DetailField, { label: string; placeholder: string }> = {
  name: { label: 'Name', placeholder: 'Tolu' },
  milestone: { label: 'Age or milestone', placeholder: '40th' },
  eventTitle: { label: 'Event title', placeholder: 'Fire Night' },
  date: { label: 'Date', placeholder: 'Sunday 19 October' },
  venue: { label: 'Venue', placeholder: 'Grace Chapel, Manchester' },
  verse: { label: 'Bible verse (optional)', placeholder: 'Psalm 118:24' },
};

export function isRunning(project: Pick<MomentProject, 'render'>): boolean {
  return project.render?.status === 'running';
}

export function canMake(project: MomentProject, meta: MomentMeta): { ok: boolean; reason?: string } {
  if (isRunning(project)) return { ok: false, reason: 'Already making this Moment.' };
  if (!project.occasion) return { ok: false, reason: 'Pick an occasion first.' };
  const min = meta.limits.minPhotos;
  if (project.photos.length < min) return { ok: false, reason: `Add at least ${min} photos.` };
  return { ok: true };
}

export function statementLimit(lengthSec: number, meta: MomentMeta): number {
  return meta.limits.statements[String(lengthSec)] ?? meta.limits.statements['15'];
}

export function statementOverflow(project: MomentProject, meta: MomentMeta): number {
  return Math.max(0, project.statements.length - statementLimit(project.lengthSec, meta));
}

/** Remove one photo. The star stays on its photo, or goes to the first when its photo is removed. */
export function removePhoto(photos: MomentPhoto[], heroIndex: number, index: number) {
  if (index < 0 || index >= photos.length) return { photos, heroIndex };
  const next = photos.filter((_, i) => i !== index);
  let hero = heroIndex;
  if (index === heroIndex) hero = 0;
  else if (index < heroIndex) hero = heroIndex - 1;
  return { photos: next, heroIndex: next.length ? Math.min(hero, next.length - 1) : 0 };
}

/** Move one photo to a new slot. The star follows its photo. */
export function movePhoto(photos: MomentPhoto[], heroIndex: number, from: number, to: number) {
  if (from < 0 || from >= photos.length || to < 0 || to >= photos.length || from === to) return { photos, heroIndex };
  const next = [...photos];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return { photos: next, heroIndex: next.indexOf(photos[heroIndex]) };
}

/** A verse as one statement: quoted with its reference when it fits, else the reference alone. */
export function verseStatement(verse: { reference: string; text: string }, max: number): string {
  const quoted = `“${verse.text}” ${verse.reference}`;
  return quoted.length <= max ? quoted : verse.reference.slice(0, max);
}

export function newSeed(): number {
  return Math.floor(Math.random() * SEED_MAX);
}
