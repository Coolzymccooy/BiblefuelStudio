import { describe, it, expect } from 'vitest';
import { parseFreeDevotional, evenDistributeWords, extractTranscript } from '../gumroadToTimeline';

const FREE_MD = `# 7 Bible Verses for Anxiety & Fear

A simple devotional from **@Biblefuel** to help you find calm.

## Day 1: Philippians 4:6-7
**Verse:** Do not be anxious about anything but in everything by prayer present your requests to God.

**Reflection:** Breathe. God is present. This moment does not control your future.

**Prayer:** Lord, I give You what I cannot carry. Amen.

---
Want more? Check the **Biblefuel 30-Day Devotional**.`;

describe('parseFreeDevotional', () => {
  it('extracts only verse/reflection/prayer text, ignoring headings/intro/footer', () => {
    const { lines, narrationText } = parseFreeDevotional(FREE_MD);
    expect(lines.join(' ')).not.toContain('7 Bible Verses');
    expect(lines.join(' ')).not.toContain('@Biblefuel');
    expect(lines.join(' ')).not.toContain('Check the');
    expect(narrationText).toContain('Do not be anxious');
    expect(narrationText).toContain('Breathe. God is present');
    expect(narrationText).toContain('I cannot carry');
  });

  it('keeps narrationText exactly equal to lines joined by a space', () => {
    const { lines, narrationText } = parseFreeDevotional(FREE_MD);
    expect(narrationText).toBe(lines.join(' '));
  });

  it('splits long segments into chunks of at most 8 words', () => {
    const { lines } = parseFreeDevotional(FREE_MD);
    for (const line of lines) {
      expect(line.split(/\s+/).length).toBeLessThanOrEqual(8);
    }
    expect(lines.length).toBeGreaterThan(1);
  });

  it('tolerates a day missing its prayer line', () => {
    const md = `## Day 1: Psalm 23\n**Verse:** The Lord is my shepherd.\n\n**Reflection:** I shall not want.`;
    const { narrationText } = parseFreeDevotional(md);
    expect(narrationText).toBe('The Lord is my shepherd. I shall not want.');
  });

  it('returns empty output for empty input', () => {
    expect(parseFreeDevotional('')).toEqual({ narrationText: '', lines: [] });
  });
});

describe('evenDistributeWords', () => {
  it('spreads N words evenly across the duration, monotonically', () => {
    const words = evenDistributeWords('one two three four', 4);
    expect(words).toHaveLength(4);
    expect(words[0].startMs).toBe(0);
    expect(words[3].endMs).toBe(4000);
    for (let i = 1; i < words.length; i++) {
      expect(words[i].startMs).toBeGreaterThanOrEqual(words[i - 1].endMs - 1);
    }
    expect(words.map((w) => w.text)).toEqual(['one', 'two', 'three', 'four']);
  });

  it('uses a rate-based fallback when duration is non-positive', () => {
    const words = evenDistributeWords('a b c', 0);
    expect(words).toHaveLength(3);
    expect(words[2].endMs).toBeGreaterThan(0);
  });

  it('returns [] for empty text', () => {
    expect(evenDistributeWords('', 5)).toEqual([]);
  });
});

describe('extractTranscript', () => {
  it('prefers provider words when present', () => {
    const provided = [{ text: 'hi', startMs: 0, endMs: 500 }];
    expect(extractTranscript({ words: provided }, 'hi there', 2)).toBe(provided);
  });

  it('falls back to even distribution when words are absent or empty', () => {
    const a = extractTranscript({ words: [] }, 'one two', 2);
    const b = extractTranscript(null, 'one two', 2);
    expect(a).toHaveLength(2);
    expect(b).toHaveLength(2);
  });
});
