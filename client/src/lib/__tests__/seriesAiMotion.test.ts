import { describe, it, expect } from 'vitest';
import { partNarration, aiMotionEstimate, aiMotionEstimateText } from '../seriesAiMotion';

describe('partNarration', () => {
    const verse = (n: number, text: string) => ({ book: 'John', chapter: 3, verse: n, text });
    it('is the passage itself: the verses in order, without their numbers', () => {
        expect(partNarration({ verses: [verse(16, 'For God so loved the world,'), verse(17, ' For God sent not his Son\n into the world')] }))
            .toBe('For God so loved the world, For God sent not his Son into the world');
    });
    it('never reads the social caption: no headline, link or follow line', () => {
        const said = partNarration({ verses: [verse(1, 'My little children')] });
        expect(said).toBe('My little children');
        expect(said).not.toMatch(/Part|YouVersion|https|Follow/);
    });
    it('a part with no verse text says nothing rather than something wrong', () => {
        expect(partNarration({ verses: [] })).toBe('');
        expect(partNarration({ verses: [verse(1, '  ')] })).toBe('');
    });
});

describe('aiMotionEstimate', () => {
    const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

    it('reads at 2.6 words a second, one clip per 10 s, priced per second', () => {
        // 78 words is 30 s: 3 clips, 30 s at $0.0756 = $2.268.
        const est = aiMotionEstimate(words(78), 0.0756);
        expect(est.seconds).toBeCloseTo(30, 6);
        expect(est.clips).toBe(3);
        expect(est.usd).toBeCloseTo(2.268, 6);
    });

    it('rounds clips up, and never says fewer than one', () => {
        expect(aiMotionEstimate(words(27), 0.1).clips).toBe(2); // 10.38 s
        expect(aiMotionEstimate(words(2), 0.1).clips).toBe(1);
        expect(aiMotionEstimate('', 0.1).clips).toBe(1);
    });

    it('prices what BytePlus bills: whole seconds per clip, at least 4 s', () => {
        // 2 words is 0.77 s, but its one clip is billed as 4 s.
        expect(aiMotionEstimate(words(2), 0.1).usd).toBeCloseTo(0.4, 6);
        // 27 words is 10.38 s over 2 clips of 5.19 s, each billed as 6 s: 12 s.
        expect(aiMotionEstimate(words(27), 0.1).usd).toBeCloseTo(1.2, 6);
        expect(aiMotionEstimate('', 0.1).usd).toBeCloseTo(0.4, 6);
    });

    it('counts words on any whitespace', () => {
        expect(aiMotionEstimate('  a\n b\tc  ', 1).seconds).toBeCloseTo(3 / 2.6, 6);
    });
});

describe('aiMotionEstimateText', () => {
    it('says it in plain words', () => {
        expect(aiMotionEstimateText({ clips: 6, usd: 0.9, seconds: 60 })).toBe('about 6 clips · ≈ $0.90');
        expect(aiMotionEstimateText({ clips: 1, usd: 0.304, seconds: 4 })).toBe('about 1 clip · ≈ $0.30');
    });
});
