import type { AmbientDrop, AmbientProject } from './ambientTypes';

/**
 * YouTube metadata drawn from what an ambient session already knows: its
 * theme, its verses, and its pictures. The operator edits it before publish;
 * this only saves them retyping the references.
 */

export interface Chapter {
  startMs: number;
  title: string;
}

const spoken = (drops: AmbientDrop[]): AmbientDrop[] =>
  [...(drops || [])].filter((d) => d.status === 'done' && d.reference).sort((a, b) => a.atMs - b.atMs);

/**
 * One chapter per verse, at the start of the picture it belongs to — which
 * is when a verse held for its section appears. The server adds them to the
 * description, forces the first to 00:00, and drops them below three (the
 * YouTube minimum).
 */
export function ambientChapters(project: AmbientProject): Chapter[] {
  const movements = project.movements || [];
  return spoken(project.drops).map((d) => {
    const m = movements.find((mv, i) => d.atMs >= mv.startMs && (d.atMs < mv.endMs || i === movements.length - 1));
    return { startMs: m ? m.startMs : d.atMs, title: d.reference };
  });
}

export function ambientDescription(project: AmbientProject): string {
  const refs = spoken(project.drops).map((d) => d.reference);
  const theme = String(project.theme || '').trim();
  if (refs.length === 0) return theme;
  const translation = String(project.translation || 'kjv').toUpperCase();
  return `${theme}\n\nScripture (${translation}): ${refs.join(' · ')}`.trim();
}

export function ambientThumbnails(project: AmbientProject): Array<{ label: string; path: string }> {
  return (project.movements || [])
    .map((m, i) => ({ label: `Picture ${i + 1}`, path: m.imageUrl || '' }))
    .filter((o) => o.path);
}
