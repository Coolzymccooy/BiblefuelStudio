export interface BgItem {
  id: string;
  url?: string;
  previewUrl?: string;
  image?: string;
  kind?: string;
  [k: string]: unknown;
}

export type GenerateMode = 'alongside' | 'replace';

/**
 * Combine generated visuals into the background-item list.
 * - 'replace': use only the generated items.
 * - 'alongside': append after the existing items.
 * Dedups by id (existing wins) and never exceeds `max`.
 */
export function applyGeneratedVisuals(
  existing: BgItem[],
  generated: BgItem[],
  mode: GenerateMode,
  max: number,
): BgItem[] {
  const base = mode === 'replace' ? [] : [...existing];
  const seen = new Set(base.map((b) => b.id));
  const out = [...base];
  for (const g of generated) {
    if (out.length >= max) break;
    if (seen.has(g.id)) continue;
    seen.add(g.id);
    out.push(g);
  }
  return out.slice(0, max);
}
