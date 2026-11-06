import { describe, expect, it } from 'vitest';
import { lyricTimingText, sceneScriptTimingBlocked, storyTimingText, timingQualityText } from '../timingQuality';
import type { LyricLine } from '../lyricVideoTypes';
import type { StoryProject } from '../storyTypes';
import type { SceneScriptProject } from '../sceneScriptTypes';

describe('Scene Script render-mode parity', () => {
  const punctuation = { words: [{ text: 'Grace', start: 0, end: 0.4 }, { text: '—', start: 0.4, end: 0.4 }, { text: 'saves', start: 0.4, end: 0.8 }], timing: { quality: 'native', tokens: [{ index: 1, text: '—', provenance: 'nonspoken' }] } };
  const blocked = (kind: string, audio: unknown, captions: unknown = { enabled: true }) => sceneScriptTimingBlocked({ captions, lines: [{ kind, text: audio === punctuation ? 'Grace — saves' : 'Grace', audio }] } as unknown as SceneScriptProject);
  it.each(['chant', 'reference'])('allows whole-line %s with unresolved/missing word spans', (kind) => {
    expect(blocked(kind, { words: [], timing: { quality: 'unresolved' } })).toBe(false);
  });
  it('exempts explicitly nonspoken punctuation but never a missing lexical token', () => {
    expect(blocked('narration', punctuation)).toBe(false);
    expect(blocked('narration', { ...punctuation, timing: undefined })).toBe(true);
    const missing = { ...punctuation, words: punctuation.words.map((w, i) => i === 2 ? { ...w, end: w.start } : w) };
    expect(blocked('narration', missing)).toBe(true);
    expect(blocked('scripture', missing)).toBe(true);
    expect(blocked('narration', { ...missing, timing: { quality: 'native', tokens: [{ index: 2, text: 'saves', provenance: 'nonspoken' }] } })).toBe(true);
  });
  it('matches legacy renderer captions-on default and preserves unknown complete timing', () => {
    expect(sceneScriptTimingBlocked({ lines: [{ kind: 'narration', audio: { words: [] } }] } as unknown as SceneScriptProject)).toBe(true);
    expect(blocked('narration', { words: [{ text: 'Grace', start: 0, end: 1 }] })).toBe(false);
  });
});

describe('ordered authored coverage', () => {
  const blocked = (texts: string[], text = 'Grace still saves') => sceneScriptTimingBlocked({ lines: [{ text, kind: 'narration', audio: { words: texts.map((text, i) => ({ text, start: i, end: i + 0.5 })), timing: { quality: 'native' } } }] } as unknown as SceneScriptProject);
  it.each([['still', 'saves'], ['Grace', 'saves'], ['Grace', 'still'], ['saves', 'still', 'Grace'], ['Grace', 'now', 'saves'], ['Grace']])('refuses missing/reordered/replaced coverage %j', (...texts) => {
    expect(blocked(texts)).toBe(true);
  });
  it('allows complete and cosmetic coverage without promoting evidence', () => {
    expect(blocked(['Grace', 'still', 'saves'])).toBe(false);
    expect(blocked(['GRACE,', 'still', 'saves!'])).toBe(false);
    expect(blocked(['Grace'], 'Grace saves')).toBe(true);
  });
});

describe('timing provenance copy', () => {
  it('labels legacy Story timing unknown even with valid word spans', () => {
    expect(storyTimingText({ transcript: { words: [{ text: 'Hello', startMs: 0, endMs: 100 }], hash: null } } as StoryProject)).toContain('quality unknown');
  });
  it('does not treat supplied word spans as verified', () => {
    expect(timingQualityText({ provenance: 'supplied', accuracy: 'unknown', verified: false })).toContain('not acoustically verified');
  });
  it('labels estimated imports explicitly', () => {
    expect(storyTimingText({ transcript: { timing: { provenance: 'estimated', estimated: true } } } as StoryProject)).toContain('Estimated word timing');
  });
  it.each(['native', 'asr-matched', 'measured'])('does not claim acoustic verification for %s', (status) => {
    expect(timingQualityText({ status, verified: true })).toMatch(/not acoustic|not been independently/);
  });
  it('keeps estimate history after a manual nudge clears the old flag', () => {
    const line = { flag: null, confidence: 1, timingQuality: { status: 'manual', warnings: [], originalEvidence: { status: 'needs-review', counts: { interpolated: 2 }, warnings: ['interpolated-words'] } } } as unknown as LyricLine;
    expect(lyricTimingText(line)).toContain('Manually adjusted');
    expect(lyricTimingText(line)).toContain('Estimated word timing');
    expect(lyricTimingText({ flag: null, confidence: 1 } as LyricLine)).toContain('quality unknown');
  });
  it('blocks zero-width, missing and unresolved caption words but not caption-free renders', () => {
    const p = { captions: { enabled: true }, lines: [{ audio: { words: [{ start: 0, end: 0 }] } }] } as unknown as SceneScriptProject;
    expect(sceneScriptTimingBlocked(p)).toBe(true);
    expect(sceneScriptTimingBlocked({ ...p, captions: { enabled: false } })).toBe(false);
    expect(sceneScriptTimingBlocked({ ...p, lines: [{ audio: { words: [] } }] } as unknown as SceneScriptProject)).toBe(true);
    expect(sceneScriptTimingBlocked({ ...p, lines: [{ audio: { words: [{ start: 0, end: 1 }], timing: { quality: 'unresolved' } } }] } as unknown as SceneScriptProject)).toBe(true);
    expect(sceneScriptTimingBlocked({ ...p, lines: [{ text: 'Grace', audio: { words: [{ text: 'Grace', start: 0, end: 1 }], timing: { quality: 'native' } } }] } as unknown as SceneScriptProject)).toBe(false);
  });
});
