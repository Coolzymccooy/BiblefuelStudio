/**
 * Bridge: turn a generated Gumroad **free** devotional (markdown) into the
 * narration text + caption lines the Timeline editor consumes. Pure — no DOM,
 * no I/O — so it is fully unit-testable. The Timeline page is an audio/caption
 * tool, so this is the text→(narratable) seam.
 */

/** Matches the per-day content lines the free lead magnet emits. */
const LABEL_RE = /^\*\*(?:Verse|Reflection|Prayer):\*\*\s*/;

/** Split text into chunks of at most `size` words (caption-line sized). */
function chunkWords(text: string, size: number): string[] {
    const words = text.trim().split(/\s+/).filter(Boolean);
    const out: string[] = [];
    for (let i = 0; i < words.length; i += size) {
        out.push(words.slice(i, i + size).join(' '));
    }
    return out;
}

/**
 * Parse the free devotional markdown into:
 *  - `lines`: caption-sized lines (<=8 words) for `sclEditedLines`
 *  - `narrationText`: exactly `lines.join(' ')` so TTS words align positionally
 *    with the caption lines (Timeline's reflowWordsFromEditedLines relies on
 *    positional pairing).
 *
 * Only `**Verse:**`, `**Reflection:**`, and `**Prayer:**` lines are kept;
 * the title, intro paragraph, day headings, and footer are ignored.
 */
export function parseFreeDevotional(markdown: string): {
    narrationText: string;
    lines: string[];
} {
    const lines: string[] = [];
    for (const raw of (markdown || '').split(/\r?\n/)) {
        if (!LABEL_RE.test(raw)) continue;
        const text = raw.replace(LABEL_RE, '').trim();
        if (!text) continue;
        for (const chunk of chunkWords(text, 8)) lines.push(chunk);
    }
    return { narrationText: lines.join(' '), lines };
}

/** Word-level timing — matches Timeline's TranscriptWord (`sclTranscript`). */
export interface TranscriptWord {
    text: string;
    startMs: number;
    endMs: number;
}

/** Average seconds-per-word used when no real audio duration is available. */
const FALLBACK_SEC_PER_WORD = 0.4;

/**
 * Spread the narration's words uniformly across `durationSec`. TTS narration is
 * steady-paced, so uniform spacing yields acceptable caption sync. When the
 * duration is unknown (<=0), estimate from a fixed speaking rate.
 */
export function evenDistributeWords(
    narrationText: string,
    durationSec: number,
): TranscriptWord[] {
    const tokens = narrationText.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];
    const safeSec = durationSec > 0 ? durationSec : tokens.length * FALLBACK_SEC_PER_WORD;
    const totalMs = Math.max(1, Math.round(safeSec * 1000));
    const per = totalMs / tokens.length;
    return tokens.map((text, i) => ({
        text,
        startMs: Math.round(i * per),
        endMs: Math.round((i + 1) * per),
    }));
}

/**
 * Resolve a transcript for Timeline. Prefer the provider's native word timings;
 * otherwise even-distribute. (The provider may instead return char-level
 * `alignment`; even distribution covers that case acceptably for steady TTS,
 * so we deliberately do not port the server's char→word converter here.)
 */
export function extractTranscript(
    data: { words?: TranscriptWord[] | null } | null | undefined,
    narrationText: string,
    durationSec: number,
): TranscriptWord[] {
    const words = data?.words;
    if (Array.isArray(words) && words.length) return words;
    return evenDistributeWords(narrationText, durationSec);
}

/** One day of the free devotional, ready to narrate + send to the Timeline. */
export interface DevotionalDay {
    dayNumber: number;
    reference: string;
    narrationText: string;
    lines: string[];
}

/** Matches the free lead magnet's per-day heading: `## Day 1: Philippians 4:6-7`. */
const DAY_HEADING_RE = /^##\s*Day\s+(\d+):\s*(.+?)\s*$/;

/**
 * Split the free devotional markdown into per-day units. Within each day, the
 * same Verse/Reflection/Prayer extraction + <=8-word chunking as
 * parseFreeDevotional is applied, and `narrationText === lines.join(' ')` holds
 * per day. Days with a heading but no content lines are dropped.
 */
export function parseFreeDevotionalDays(markdown: string): DevotionalDay[] {
    const days: DevotionalDay[] = [];
    let current: { dayNumber: number; reference: string; lines: string[] } | null = null;
    const flush = () => {
        if (current && current.lines.length) {
            days.push({
                dayNumber: current.dayNumber,
                reference: current.reference,
                narrationText: current.lines.join(' '),
                lines: current.lines,
            });
        }
    };
    for (const raw of (markdown || '').split(/\r?\n/)) {
        const heading = raw.match(DAY_HEADING_RE);
        if (heading) {
            flush();
            current = { dayNumber: Number(heading[1]), reference: heading[2].trim(), lines: [] };
            continue;
        }
        if (!current || !LABEL_RE.test(raw)) continue;
        const text = raw.replace(LABEL_RE, '').trim();
        if (!text) continue;
        for (const chunk of chunkWords(text, 8)) current.lines.push(chunk);
    }
    flush();
    return days;
}
