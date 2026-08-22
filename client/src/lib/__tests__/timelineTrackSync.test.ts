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

  it('represents captions as a single lane clip, not one per line', () => {
    const next = syncSidecarTracks(project(), {
      musicPaths: [], captionLines: ['one', 'two', 'three'],
    });
    // The lane answers "are there captions", not "how many lines" - a clip per
    // line would render as unreadable slivers.
    expect(track(next, 'captions').clips).toHaveLength(1);
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
