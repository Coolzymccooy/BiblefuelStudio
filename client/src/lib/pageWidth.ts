/**
 * How wide each screen's content column may grow on desktop.
 *
 * The app is designed mobile-first, which is right for the phone but left
 * every page capped at `max-w-3xl` (768px) on desktop — so an editing surface
 * on a 1920px monitor sat in a narrow ribbon with large empty margins. Editing
 * screens (timeline, studio) are the ones that genuinely need the pixels;
 * reading and form screens still read better narrow, so they keep the default.
 *
 * Kept as data rather than a ternary chain so adding a screen is one line and
 * the mapping can be tested without rendering the app shell.
 */

/** Default column width — comfortable line length for reading and forms. */
export const DEFAULT_PAGE_WIDTH = 'max-w-3xl';

const WIDTH_BY_PREFIX: Array<{ prefix: string; width: string }> = [
  // Multi-track editing surfaces: closer to a desktop NLE, where horizontal
  // room is the whole point.
  { prefix: '/app/timeline', width: 'max-w-[1600px]' },
  { prefix: '/app/studio', width: 'max-w-[1600px]' },
  // Two-pane layouts: main column plus a side rail.
  { prefix: '/app/voice-audio', width: 'max-w-6xl' },
  { prefix: '/app/story', width: 'max-w-6xl' },
  { prefix: '/app/backgrounds', width: 'max-w-6xl' },
  { prefix: '/app/jobs', width: 'max-w-6xl' },
];

/**
 * Resolve the max-width class for a pathname.
 *
 * Matches on the LONGEST prefix so a more specific route wins over a shorter
 * one that happens to share its start.
 *
 * @param pathname e.g. "/app/timeline"
 * @returns a Tailwind max-width class
 */
export function pageWidthClass(pathname: string): string {
  const path = String(pathname || '');
  let best: { prefix: string; width: string } | null = null;
  for (const entry of WIDTH_BY_PREFIX) {
    if (!path.startsWith(entry.prefix)) continue;
    if (!best || entry.prefix.length > best.prefix.length) best = entry;
  }
  return best ? best.width : DEFAULT_PAGE_WIDTH;
}
