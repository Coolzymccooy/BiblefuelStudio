import type { LyricProject, RenderAspect } from './lyricVideoTypes';

export interface ShortsTrimOffer {
  /** The trim checkbox is worth showing. */
  offered: boolean;
  /** Ticking it is safe: no lyric line would be cut. */
  allowed: boolean;
  /** Why it is refused; empty when allowed. */
  reason: string;
}

// These mirror server/src/lib/lyricVideo/brandingPlan.js; keep the two in step.
const MIN_SOURCE_SEC = 180;
const MAX_SOURCE_SEC = 190;
const LINE_LIMIT_SEC = 178.5;

const NOT_OFFERED = 'Only for portrait songs between 3:00 and 3:10.';
const WOULD_CUT = 'A lyric line ends after 2:58, so trimming would cut it.';

/** Whether the Shorts trim (cut to 2:59) is offered for this frame, and whether it is safe. */
export function shortsTrimOffer(project: LyricProject, aspect: RenderAspect): ShortsTrimOffer {
  const durationSec = project.song?.durationSec;
  const offered = aspect === 'portrait' && typeof durationSec === 'number'
    && durationSec >= MIN_SOURCE_SEC && durationSec <= MAX_SOURCE_SEC;
  if (!offered) return { offered: false, allowed: false, reason: NOT_OFFERED };
  const cutsALine = (project.lines ?? []).some((l) => Number.isFinite(l?.end) && (l.end as number) > LINE_LIMIT_SEC);
  if (cutsALine) return { offered: true, allowed: false, reason: WOULD_CUT };
  return { offered: true, allowed: true, reason: '' };
}
