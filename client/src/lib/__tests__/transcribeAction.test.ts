import { describe, it, expect } from 'vitest';
import { pickTranscribeAction, type TranscriptRecord } from '../transcribeAction';

const rec = (sourceFile: string): TranscriptRecord => ({
  id: sourceFile, userId: 'u1', sourceFile, label: sourceFile,
  words: [], editedLines: [], typographyPreset: null, durationSec: null,
  lineCount: 0, createdAt: '', updatedAt: '',
});

describe('pickTranscribeAction', () => {
  it('reuses when a history entry matches the source basename', () => {
    const r = pickTranscribeAction([rec('a.mp3')], '/x/y/a.mp3');
    expect(r.mode).toBe('reuse');
    if (r.mode === 'reuse') expect(r.record.sourceFile).toBe('a.mp3');
  });

  it('matches on basename even when history stored a bare name and path has dirs', () => {
    const r = pickTranscribeAction([rec('a.mp3')], 'C:\\\\out\\\\a.mp3');
    expect(r.mode).toBe('reuse');
  });

  it('runs when no history matches', () => {
    expect(pickTranscribeAction([rec('a.mp3')], '/x/b.mp3').mode).toBe('run');
  });

  it('runs when sourceMediaPath is null/empty', () => {
    expect(pickTranscribeAction([rec('a.mp3')], null).mode).toBe('run');
    expect(pickTranscribeAction([], '').mode).toBe('run');
  });
});
