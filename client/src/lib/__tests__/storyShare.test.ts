import { describe, it, expect } from 'vitest';
import { storyChapters, storyDescription, storyTagline } from '../storyShare';
import type { StoryProject } from '../storyTypes';

const project = (over: Partial<StoryProject> = {}) => ({
  projectId: 'p', title: '1 John 2:5 · Part 1', style: 'cinematic-bible',
  source: { audioPath: null, durationMs: 480_000 },
  scenes: Array.from({ length: 12 }, (_, i) => ({ id: `s${i}` })),
  longform: {
    summary: 'Whoso keepeth his word (1 John 2:5), in him verily is the love of God perfected.',
    sections: [{ heading: 'Opening', startMs: 0 }, { heading: 'The love of God', startMs: 90_000 }, { heading: 'Closing', startMs: 400_000 }],
  },
  ...over,
}) as unknown as StoryProject;

describe('storyTagline', () => {
  it('says how long and what look', () => {
    expect(storyTagline(project())).toBe('8 minutes · cinematic bible');
  });
  it('leaves out what it does not know', () => {
    expect(storyTagline(project({ source: { audioPath: null, durationMs: 0 }, style: 'unknown' }))).toBe('');
  });
});

describe('storyDescription', () => {
  it('summary (verses not links), overview, music credit, then the chapters heading', () => {
    expect(storyDescription(project(), { label: 'Prayer Piano', credit: 'Music from Pixabay' })).toBe([
      'Whoso keepeth his word (1 John 2∶5), in him verily is the love of God perfected.',
      '8 minutes · 12 scenes · Cinematic Bible',
      'Music: Music from Pixabay',
      'Chapters:',
    ].join('\n\n'));
  });

  it('names an uncredited song, and has no heading without three sections', () => {
    const text = storyDescription(project({ longform: { summary: '', sections: [{ heading: 'Only', startMs: 0 }] } as StoryProject['longform'] }), { label: 'My upload' });
    expect(text).toBe('8 minutes · 12 scenes · Cinematic Bible\n\nMusic: My upload');
  });

  it('no music, no credit line', () => {
    expect(storyDescription(project())).not.toMatch(/Music:/);
  });
});

describe('storyChapters', () => {
  it('one per section', () => {
    expect(storyChapters(project()).map((c) => c.title)).toEqual(['Opening', 'The love of God', 'Closing']);
  });
});
