import { describe, it, expect } from 'vitest';
import { hiddenLaneWarning, setTrackFlag } from './hiddenLanes';
import type { TimelineProject, TimelineTrack } from './timelineProject';

// Hiding a lane EXCLUDES it from the render (decided 2026-09-17). That is
// normal NLE behaviour, but it is also the one setting that can silently ship
// the wrong video: the operator hides the music bed to preview a cut, forgets,
// renders a week later, and the sermon goes out silent. So Render must warn
// and name the lanes. These tests pin that warning.

function track(over: Partial<TimelineTrack> = {}): TimelineTrack {
  return { id: 't1', kind: 'video', label: 'Real footage', clips: [], ...over } as TimelineTrack;
}

function project(tracks: TimelineTrack[]): TimelineProject {
  return { id: 'p1', title: 'Test', tracks, assets: {}, scenes: [] } as unknown as TimelineProject;
}

const clip = { id: 'c1', assetId: 'a1', startSec: 0, durationSec: 5 } as TimelineTrack['clips'][number];

describe('hiddenLaneWarning', () => {
  it('is null when nothing is hidden — Render must not nag', () => {
    expect(hiddenLaneWarning(project([track(), track({ id: 't2', kind: 'music' })]))).toBeNull();
  });

  it('names the single hidden lane', () => {
    const w = hiddenLaneWarning(project([
      track({ hidden: true, label: 'Music bed', clips: [clip] }),
      track({ id: 't2', kind: 'video' }),
    ]));
    expect(w).not.toBeNull();
    expect(w!.labels).toEqual(['Music bed']);
    expect(w!.message).toContain('Music bed');
  });

  it('names every hidden lane, in lane order', () => {
    const w = hiddenLaneWarning(project([
      track({ id: 't1', label: 'Real footage', hidden: true, clips: [clip] }),
      track({ id: 't2', kind: 'music', label: 'Music bed' }),
      track({ id: 't3', kind: 'captions', label: 'Captions', hidden: true, clips: [clip] }),
    ]));
    expect(w!.labels).toEqual(['Real footage', 'Captions']);
    expect(w!.message).toContain('Real footage');
    expect(w!.message).toContain('Captions');
  });

  it('ignores a hidden lane that has no clips — nothing is being lost', () => {
    // Hiding an empty lane changes no output, so warning about it would train
    // the operator to dismiss the dialog without reading it.
    expect(hiddenLaneWarning(project([track({ hidden: true, clips: [] })]))).toBeNull();
  });

  it('says plainly that hidden lanes are left out of the render', () => {
    const w = hiddenLaneWarning(project([track({ hidden: true, label: 'Music bed', clips: [clip] })]));
    expect(w!.message.toLowerCase()).toMatch(/not|won't|left out|exclud/);
  });

  it('never throws on a malformed project', () => {
    expect(hiddenLaneWarning(undefined as unknown as TimelineProject)).toBeNull();
    expect(hiddenLaneWarning({} as TimelineProject)).toBeNull();
  });
});

describe('setTrackFlag', () => {
  it('hides one lane without touching the others', () => {
    const p = project([track({ id: 't1' }), track({ id: 't2', kind: 'music' })]);
    const next = setTrackFlag(p, 't2', 'hidden', true);
    expect(next.tracks[0].hidden).toBeUndefined();
    expect(next.tracks[1].hidden).toBe(true);
  });

  it('returns a NEW project and leaves the original untouched', () => {
    const p = project([track({ id: 't1' })]);
    const next = setTrackFlag(p, 't1', 'hidden', true);
    expect(next).not.toBe(p);
    expect(next.tracks).not.toBe(p.tracks);
    expect(p.tracks[0].hidden).toBeUndefined();
  });

  it('toggles back off', () => {
    const p = project([track({ id: 't1', hidden: true })]);
    expect(setTrackFlag(p, 't1', 'hidden', false).tracks[0].hidden).toBe(false);
  });

  it('sets locked independently of hidden', () => {
    const p = project([track({ id: 't1', hidden: true })]);
    const next = setTrackFlag(p, 't1', 'locked', true);
    expect(next.tracks[0].hidden).toBe(true);
    expect(next.tracks[0].locked).toBe(true);
  });

  it('stamps updatedAt so the change is persisted like any edit', () => {
    const p = project([track({ id: 't1' })]);
    expect(setTrackFlag(p, 't1', 'hidden', true).updatedAt).toBeTruthy();
  });

  it('is a no-op for an unknown track id', () => {
    const p = project([track({ id: 't1' })]);
    const next = setTrackFlag(p, 'nope', 'hidden', true);
    expect(next.tracks[0].hidden).toBeUndefined();
  });
});
