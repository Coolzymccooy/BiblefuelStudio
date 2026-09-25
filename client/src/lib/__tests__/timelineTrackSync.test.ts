import { describe, it, expect } from 'vitest';
import { syncSidecarTracks } from '../timelineTrackSync';
import { buildWorshipDocumentaryProject } from '../timelineProject';

const project = () => buildWorshipDocumentaryProject({ title: 'T' });
const track = (p: ReturnType<typeof project>, kind: string) =>
  p.tracks.find((t) => t.kind === kind)!;

describe('syncSidecarTracks', () => {
  it('shows music the operator added as a clip on the music lane', () => {
    const next = syncSidecarTracks(project(), { musicPaths: ['/m/bed.mp3'], captionLines: [] });
    expect(track(next, 'music').clips).toHaveLength(1);
  });

  it('adds one clip per music track, in order', () => {
    const next = syncSidecarTracks(project(), {
      musicPaths: ['/m/a.mp3', '/m/b.mp3'], captionLines: [],
    });
    const clips = track(next, 'music').clips;
    expect(clips).toHaveLength(2);
    expect(clips[0].startSec).toBeLessThanOrEqual(clips[1].startSec);
  });

  it('represents captions as one clip PER LINE carrying its text, timed like the stage', () => {
    const next = syncSidecarTracks(project(), {
      musicPaths: [], captionLines: ['one', 'two', 'three'],
    });
    // The renderer burns `clip.text` between start and end; a lane-wide
    // clip with only a label rendered no captions at all.
    const clips = track(next, 'captions').clips;
    expect(clips).toHaveLength(3);
    expect(clips.map((c) => c.text)).toEqual(['one', 'two', 'three']);
    const total = project().targetDurationSec;
    expect(clips[1].startSec).toBeCloseTo(total / 3, 2);
    expect(clips[2].durationSec).toBeCloseTo(total / 3, 2);
  });

  it('sees a changed line as a change (same ids, new text)', () => {
    const a = syncSidecarTracks(project(), { musicPaths: [], captionLines: ['one'] });
    const b = syncSidecarTracks(a, { musicPaths: [], captionLines: ['uno'] });
    expect(b).not.toBe(a);
    expect(track(b, 'captions').clips[0].text).toBe('uno');
  });

  it('clears the lane when the source is emptied', () => {
    const withMusic = syncSidecarTracks(project(), { musicPaths: ['/m/a.mp3'], captionLines: [] });
    const cleared = syncSidecarTracks(withMusic, { musicPaths: [], captionLines: [] });
    expect(track(cleared, 'music').clips).toHaveLength(0);
  });

  it('is idempotent - syncing the same input twice changes nothing', () => {
    const a = syncSidecarTracks(project(), { musicPaths: ['/m/a.mp3'], captionLines: ['x'] });
    const b = syncSidecarTracks(a, { musicPaths: ['/m/a.mp3'], captionLines: ['x'] });
    expect(b).toBe(a);
  });

  it('never mutates the project it was given', () => {
    const p = project();
    const before = JSON.stringify(p);
    syncSidecarTracks(p, { musicPaths: ['/m/a.mp3'], captionLines: ['x'] });
    expect(JSON.stringify(p)).toBe(before);
  });

  it('leaves video, b-roll and effects lanes alone', () => {
    const p = project();
    const next = syncSidecarTracks(p, { musicPaths: ['/m/a.mp3'], captionLines: ['x'] });
    for (const kind of ['video', 'broll', 'voiceover', 'effects']) {
      expect(track(next, kind).clips).toEqual(track(p, kind).clips);
    }
  });

  it('drops orphaned assets so repeated syncs do not grow the project', () => {
    const a = syncSidecarTracks(project(), { musicPaths: ['/m/a.mp3'], captionLines: [] });
    const b = syncSidecarTracks(a, { musicPaths: ['/m/b.mp3'], captionLines: [] });
    const stale = Object.values(b.assets).filter((x) => x.path === '/m/a.mp3');
    expect(stale).toHaveLength(0);
  });

  it('labels the music clip by filename so the lane is readable', () => {
    const next = syncSidecarTracks(project(), {
      musicPaths: ['/uploads/hopeful-bed.mp3'], captionLines: [],
    });
    const clip = track(next, 'music').clips[0];
    expect(next.assets[clip.assetId].label).toMatch(/hopeful-bed/);
  });
});

describe('captions follow the voice', () => {
  it('shares the voice span in proportion to line length when only the span is known', () => {
    const next = syncSidecarTracks(project(), {
      musicPaths: [], captionLines: ['short', 'a much much longer line'],
      voice: { startSec: 10, durationSec: 20 },
    });
    const clips = track(next, 'captions').clips;
    expect(clips[0].startSec).toBeCloseTo(10, 2);
    expect(clips[0].durationSec).toBeLessThan(clips[1].durationSec);
    expect(clips[1].startSec + clips[1].durationSec).toBeCloseTo(30, 1);
  });

  it('aligns each line to the words the provider timed, in order', () => {
    const words = [
      { text: 'You', startMs: 50, endMs: 250 }, { text: 'are', startMs: 263, endMs: 376 }, { text: 'loved', startMs: 400, endMs: 900 },
      { text: 'Rest', startMs: 2800, endMs: 3100 }, { text: 'now', startMs: 3150, endMs: 3600 },
    ];
    const next = syncSidecarTracks(project(), {
      musicPaths: [], captionLines: ['You are loved', 'Rest now'],
      voice: { startSec: 5, durationSec: 4, words },
    });
    const clips = track(next, 'captions').clips;
    expect(clips[0].startSec).toBeCloseTo(5.05, 2);
    expect(clips[0].startSec + clips[0].durationSec).toBeCloseTo(5.9, 2);
    expect(clips[1].startSec).toBeCloseTo(7.8, 2);
    expect(clips[1].startSec + clips[1].durationSec).toBeCloseTo(8.6, 2);
  });
});
