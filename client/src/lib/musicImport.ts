/**
 * Adding many tracks to your music library at once — e.g. a folder of
 * YouTube Audio Library downloads — with one licence for the lot.
 */

export interface ImportLicence {
  value: string;
  label: string;
}

/**
 * What the operator can record for a batch. Anything but 'unknown' counts as
 * cleared for the ambient bed's licence gate (server/src/lib/ambient/stages.js).
 */
export const IMPORT_LICENCES: readonly ImportLicence[] = [
  { value: 'unknown', label: 'Not recorded yet' },
  { value: 'youtube-audio-library', label: 'YouTube Audio Library (no attribution needed)' },
  { value: 'cleared', label: 'Cleared (my own, or licensed)' },
];

/** "Pastoral - Asher Fulero.mp3" → "Pastoral — Asher Fulero". */
export function trackLabelFromFilename(name: string): string {
  return String(name || '')
    .replace(/\.[^.]+$/, '')
    .replace(/\s+-\s+/g, ' — ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Case, spacing and dash style don't make a different track.
const labelKey = (label: string) => String(label || '')
  .toLowerCase()
  .replace(/[—–]/g, '-')
  .replace(/\s*-\s*/g, ' - ')
  .replace(/\s+/g, ' ')
  .trim();

export interface ImportPlan {
  toAdd: Array<{ file: File; label: string }>;
  /** Labels left out because the library (or this batch) already has them. */
  skipped: string[];
  /** Library refs of the skipped tracks the library already had, in order. */
  matchedRefs: string[];
}

/**
 * Which of the chosen files to add. A track whose name the library already
 * has is skipped, so running the same folder again after a failure only adds
 * what's missing.
 */
export function planImport(
  files: readonly File[],
  existing: ReadonlyArray<{ label: string; ref?: string }>,
): ImportPlan {
  const libraryRefs = new Map(existing.map((t) => [labelKey(t.label), t.ref] as const));
  const seen = new Set(libraryRefs.keys());
  const toAdd: ImportPlan['toAdd'] = [];
  const skipped: string[] = [];
  const matchedRefs: string[] = [];
  for (const file of files) {
    const label = trackLabelFromFilename(file.name);
    const key = labelKey(label);
    if (seen.has(key)) {
      skipped.push(label);
      const ref = libraryRefs.get(key);
      if (ref && !matchedRefs.includes(ref)) matchedRefs.push(ref);
      continue;
    }
    seen.add(key);
    toAdd.push({ file, label });
  }
  return { toAdd, skipped, matchedRefs };
}
