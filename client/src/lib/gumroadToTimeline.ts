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
