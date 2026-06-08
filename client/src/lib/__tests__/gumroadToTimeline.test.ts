import { describe, it, expect } from 'vitest';
import { parseFreeDevotional } from '../gumroadToTimeline';

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
