import { describe, it, expect } from 'vitest';
import { planMusicScenes, musicVideoEstimate, musicVideoEstimateText } from '../musicVideoPlan';
import type { LyricLine, LyricSection } from '../lyricVideoTypes';

let n = 0;
const line = (sectionId: string, start: number, end: number, text = `line ${++n}`): LyricLine => ({
  id: `l${n}`, sectionId, kind: 'lead', text, effect: 'auto', start, end, words: [{ text, start, end }],
});
const section = (id: string, kind: LyricSection['kind'], label: string, start?: number): LyricSection =>
  ({ id, kind, label, ...(start === undefined ? {} : { start }) });

// The same cases as server/src/lib/musicVideo/scenePlan.test.js: the two must agree.
describe('planMusicScenes (client copy of the server plan)', () => {
  it('one scene per section, to the next start', () => {
    const scenes = planMusicScenes({
      sections: [section('s1', 'verse', 'Verse 1', 0), section('s2', 'chorus', 'Chorus', 10)],
      lines: [line('s1', 0.5, 3), line('s1', 4, 7), line('s2', 10.2, 13), line('s2', 14, 18)],
      durationSec: 20,
    });
    expect(scenes.map((s) => [s.startMs, s.endMs, s.kind])).toEqual([[0, 10000, 'verse'], [10000, 20000, 'chorus']]);
  });

  it('stops at the audible end', () => {
    const scenes = planMusicScenes({ sections: [section('s1', 'verse', 'V', 0)], lines: [line('s1', 1, 6)], durationSec: 20, audibleEnd: 9 });
    expect(scenes[scenes.length - 1].endMs).toBe(9000);
  });

  it('splits a long section at line starts', () => {
    const scenes = planMusicScenes({
      sections: [section('s1', 'verse', 'V', 0)],
      lines: [0, 5, 10, 15, 20, 25].map((t) => line('s1', t, t + 4)),
      durationSec: 30,
    });
    expect(scenes.map((s) => [s.startMs, s.endMs])).toEqual([[0, 10000], [10000, 20000], [20000, 30000]]);
  });

  it('splits an over-long line evenly', () => {
    const scenes = planMusicScenes({ sections: [section('s1', 'bridge', 'B', 0)], lines: [line('s1', 0, 30)], durationSec: 30 });
    expect(scenes.map((s) => s.endMs - s.startMs)).toEqual([10000, 10000, 10000]);
  });

  it('merges a tiny piece, or shares it out when neither neighbour has room', () => {
    const merged = planMusicScenes({
      sections: [section('s1', 'verse', 'V', 0), section('s2', 'chorus', 'T', 10), section('s3', 'verse', 'V2', 12)],
      lines: [line('s1', 1, 8), line('s2', 10.1, 11.9), line('s3', 12.5, 20)],
      durationSec: 22,
    });
    expect(merged.map((s) => [s.startMs, s.endMs])).toEqual([[0, 12000], [12000, 22000]]);
    const shared = planMusicScenes({
      sections: [section('s1', 'verse', 'V1', 0), section('s2', 'chorus', 'C', 11), section('s3', 'verse', 'V2', 13)],
      lines: [line('s1', 0.5, 10), line('s2', 11.2, 12.8), line('s3', 13.2, 24)],
      durationSec: 24.5,
    });
    expect(shared.map((s) => [s.startMs, s.endMs])).toEqual([[0, 6500], [6500, 13000], [13000, 24500]]);
  });

  it('cuts a song with no section starts into about 8 s pieces', () => {
    const scenes = planMusicScenes({
      sections: [section('s1', 'verse', 'V')],
      lines: Array.from({ length: 20 }, (_, i) => line('s1', i * 2, i * 2 + 1.5)),
      durationSec: 40,
    });
    expect(scenes).toHaveLength(5);
  });

  it('gives an intro and an instrumental gap scenes of their own', () => {
    const scenes = planMusicScenes({
      sections: [section('s1', 'verse', 'Verse 1', 6), section('s2', 'chorus', 'Chorus', 30)],
      lines: [line('s1', 6, 8), line('s1', 9, 11), line('s1', 12, 14), line('s2', 30.5, 36)],
      durationSec: 40,
    });
    expect(scenes.map((s) => [s.startMs, s.endMs, s.kind])).toEqual([
      [0, 6000, 'instrumental'], [6000, 12000, 'verse'], [12000, 21000, 'verse'], [21000, 30000, 'instrumental'], [30000, 40000, 'chorus'],
    ]);
  });

  it('is empty for a song with no length', () => {
    expect(planMusicScenes({ sections: [], lines: [], durationSec: 0 })).toEqual([]);
  });
});

describe('musicVideoEstimate', () => {
  it('counts one clip per scene, each billed at its clip length (4 to 12 s)', () => {
    const scenes = [{ startMs: 0, endMs: 2500 }, { startMs: 2500, endMs: 12500 }, { startMs: 12500, endMs: 30000 }];
    // 4 s (the minimum) + 10 s + 12 s (the maximum) = 26 s.
    const estimate = musicVideoEstimate(scenes, 0.1);
    expect(estimate.clips).toBe(3);
    expect(estimate.seconds).toBe(26);
    expect(estimate.usd).toBeCloseTo(2.6, 9);
  });

  it('reads as about N clips and a price', () => {
    expect(musicVideoEstimateText({ clips: 3, seconds: 26, usd: 2.6 })).toBe('about 3 clips · ≈ $2.60');
    expect(musicVideoEstimateText({ clips: 1, seconds: 4, usd: 0.3 })).toBe('about 1 clip · ≈ $0.30');
  });
});
