import { describe, it, expect } from 'vitest';
import { chapterPreviewLines, chapterStamp } from '../youtubeChapters';

describe('chapterPreviewLines', () => {
  it('reads as the server writes it: sorted, first at 00:00, verses not links', () => {
    expect(chapterPreviewLines([
      { startMs: 4_050_000, title: '📖 John 14:27' },
      { startMs: 1_200, title: '♪ Grace (3:49)' },
      { startMs: 223_000, title: '♪ Peace' },
    ])).toEqual(['00:00 ♪ Grace (3∶49)', '03:43 ♪ Peace', '1:07:30 📖 John 14∶27']);
  });

  it('formats hours only when there are some', () => {
    expect(chapterStamp(65_000)).toBe('01:05');
    expect(chapterStamp(3_725_000)).toBe('1:02:05');
  });
});
