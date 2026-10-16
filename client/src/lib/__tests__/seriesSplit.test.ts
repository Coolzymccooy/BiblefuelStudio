import { describe, it, expect } from 'vitest';
import { VERSES_PER_PART_OPTIONS, parseVersesPerPart, planSummary, lengthNote } from '../seriesSplit';

const seg = (from: number, to: number, seconds: number) => ({
    verseFrom: from,
    verseTo: to,
    seconds,
    verses: Array.from({ length: to - from + 1 }, (_, i) => ({ verse: from + i, text: 'x.' })),
});

describe('verses per video choices', () => {
    it('offers Auto first, then 1, 2 and 3 verses, then one video', () => {
        expect(VERSES_PER_PART_OPTIONS.map((o) => o.value)).toEqual(['auto', 1, 2, 3, 'one']);
    });
    it('reads a select value back into the value the server takes', () => {
        expect(parseVersesPerPart('auto')).toBe('auto');
        expect(parseVersesPerPart('one')).toBe('one');
        expect(parseVersesPerPart('2')).toBe(2);
        expect(parseVersesPerPart('nonsense')).toBe('auto');
    });
});

describe('planSummary', () => {
    it('says how the verses were split: 1 John 2:1-4 into two videos', () => {
        expect(planSummary({ totalParts: 2, segments: [seg(1, 2, 24), seg(3, 4, 17)] })).toBe('4 verses → 2 videos: 1–2, 3–4');
    });
    it('one verse, one video', () => {
        expect(planSummary({ totalParts: 1, segments: [seg(16, 16, 9)] })).toBe('1 verse → 1 video: 16');
    });
});

describe('lengthNote', () => {
    it('says nothing when every video fits the length set, counting the part intro', () => {
        expect(lengthNote({ targetSeconds: 22, stretched: false, segments: [seg(1, 2, 25), seg(3, 4, 17)] })).toBeNull();
    });
    it('explains when Auto made the videos longer to fit 12', () => {
        expect(lengthNote({ targetSeconds: 22, stretched: true, segments: [seg(1, 3, 33), seg(4, 6, 31)] }))
            .toBe('Videos run up to about 33 s, longer than your 22 s, so the passage fits in 12 videos.');
    });
    it('names the parts that run past the length set', () => {
        expect(lengthNote({ targetSeconds: 22, stretched: false, segments: [seg(1, 2, 27), seg(3, 3, 9), seg(4, 6, 31)] }))
            .toBe('Parts 1 and 3 run longer than your 22 s (up to about 31 s). Every verse is still read.');
    });
    it('one long part', () => {
        expect(lengthNote({ targetSeconds: 22, stretched: false, segments: [seg(1, 4, 37)] }))
            .toBe('Part 1 runs longer than your 22 s (up to about 37 s). Every verse is still read.');
    });
});
