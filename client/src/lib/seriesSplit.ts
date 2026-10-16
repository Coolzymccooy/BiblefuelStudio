/**
 * How a Series passage is split into videos. The server does the split (it
 * keeps every sentence whole); this is the choice the user makes and the
 * words that describe the result.
 */

/** "auto" fits whole sentences into the video length; "one" is the whole passage. */
export type VersesPerPart = 'auto' | 'one' | 1 | 2 | 3;

export const VERSES_PER_PART_OPTIONS: ReadonlyArray<{ value: VersesPerPart; label: string }> = [
    { value: 'auto', label: 'Auto (fits your video length)' },
    { value: 1, label: '1 verse' },
    { value: 2, label: '2 verses' },
    { value: 3, label: '3 verses' },
    { value: 'one', label: 'One video' },
];

/** The part intro and the closing line, which the length set does not count. */
const INTRO_OUTRO_SECONDS = 3;

export function parseVersesPerPart(raw: string): VersesPerPart {
    const match = VERSES_PER_PART_OPTIONS.find((o) => String(o.value) === raw);
    return match ? match.value : 'auto';
}

interface SplitSegment {
    verseFrom: number;
    verseTo: number;
    verses: unknown[];
    seconds?: number;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const range = (s: SplitSegment) => (s.verseFrom === s.verseTo ? `${s.verseFrom}` : `${s.verseFrom}–${s.verseTo}`);

/** "4 verses → 2 videos: 1–2, 3–4" */
export function planSummary(plan: { totalParts: number; segments: SplitSegment[] }): string {
    const verses = plan.segments.reduce((n, s) => n + s.verses.length, 0);
    return `${plural(verses, 'verse')} → ${plural(plan.totalParts, 'video')}: ${plan.segments.map(range).join(', ')}`;
}

const listParts = (numbers: number[]) =>
    numbers.length === 1 ? `Part ${numbers[0]}` : `Parts ${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}`;

/** Why some videos run past the length set, or null when none do. */
export function lengthNote(plan: { targetSeconds?: number; stretched?: boolean; segments: SplitSegment[] }): string | null {
    const target = plan.targetSeconds;
    if (!target) return null;
    const longest = Math.max(0, ...plan.segments.map((s) => s.seconds ?? 0));
    if (plan.stretched) {
        return `Videos run up to about ${longest} s, longer than your ${target} s, so the passage fits in 12 videos.`;
    }
    const long = plan.segments
        .map((s, i) => ({ part: i + 1, seconds: s.seconds ?? 0 }))
        .filter((p) => p.seconds > target + INTRO_OUTRO_SECONDS);
    if (long.length === 0) return null;
    const verb = long.length === 1 ? 'runs' : 'run';
    return `${listParts(long.map((p) => p.part))} ${verb} longer than your ${target} s (up to about ${longest} s). Every verse is still read.`;
}
