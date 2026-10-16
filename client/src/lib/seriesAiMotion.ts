/**
 * Series "AI motion": what a part's narration is, and roughly what animating
 * its Story video would cost. The estimate and the send both read the
 * narration from partNarration, so the price shown is for the words sent.
 */
import { clipSecondsOf } from './storyWizard';

/** Narration speed used for the estimate, in words a second. */
const WORDS_PER_SECOND = 2.6;
/** The server asks the segmenter for 10 s scenes on an AI motion import. */
const SCENE_SEC = 10;

/**
 * The words a part is narrated with: the passage itself. The caption is the
 * social post (headline, numbered verses, YouVersion link, "follow" line) and
 * is never read aloud; the hook is the passage's own opening, so reading it
 * as well said the first line twice.
 */
export function partNarration(seg: { verses: { text: string }[] }): string {
    return seg.verses
        .map((v) => String(v.text || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join(' ');
}

export interface AiMotionEstimate {
    clips: number;
    seconds: number;
    usd: number;
}

/** About how many clips, and what they cost, at `usdPerSecond` (Standard, portrait). */
export function aiMotionEstimate(narration: string, usdPerSecond: number): AiMotionEstimate {
    const words = narration.split(/\s+/).filter(Boolean).length;
    const seconds = words / WORDS_PER_SECOND;
    const clips = Math.max(1, Math.ceil(seconds / SCENE_SEC));
    // Priced as the server bills (sceneClipSec): each clip is whole seconds,
    // at least 4 and at most 12, whatever the narration's exact length.
    const clipSec = clipSecondsOf(seconds / clips - 1e-9);
    return { clips, seconds, usd: clips * clipSec * usdPerSecond };
}

export function aiMotionEstimateText({ clips, usd }: AiMotionEstimate): string {
    return `about ${clips} ${clips === 1 ? 'clip' : 'clips'} · ≈ $${usd.toFixed(2)}`;
}
