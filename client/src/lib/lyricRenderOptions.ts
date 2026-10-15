import type { RenderAspect } from './lyricVideoTypes';

/** The video shapes a lyric video can be made in: the picker's wording and the short name used in lists. */
export const ASPECTS: Array<{ id: RenderAspect; label: string; name: string }> = [
  { id: 'portrait', label: 'Portrait 9:16 — best for Shorts and TikTok', name: 'Portrait' },
  { id: 'landscape', label: 'Landscape 16:9', name: 'Landscape' },
  { id: 'square', label: 'Square 1:1', name: 'Square' },
];

/** "Portrait" for 'portrait'; an unknown shape is shown as it was stored. */
export const aspectName = (id: RenderAspect): string => ASPECTS.find((a) => a.id === id)?.name ?? id;
