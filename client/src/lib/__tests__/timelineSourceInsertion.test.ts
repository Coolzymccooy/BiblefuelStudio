import { describe, expect, it } from 'vitest';
import { buildWorshipDocumentaryProject, insertSourceMediaOnTimeline } from '../timelineProject';
import { insertMeasuredSource } from '../timelineSourceInsertion';
const project = () => buildWorshipDocumentaryProject({ title: 'Synthetic', targetDurationSec: 270 });
const source = { path: '/outputs/source.mov', label: 'Source', kind: 'video' as const, info: { durationSec: 61.466667, width: 480, height: 854 } };
const inserted = (p: ReturnType<typeof project>) => p.tracks.find(t => t.kind === 'video')!.clips.at(-1)!;
describe('measured source insertion', () => {
  it('retains full measured source and portrait dimensions in an empty project without changing its target or scenes', () => {
    const before = project(), after = insertMeasuredSource(before, source), clip = inserted(after);
    expect(after.aspect).toBe('9:16'); expect(after.targetDurationSec).toBe(270); expect(after.scenes).toEqual(before.scenes);
    expect(after.assets[clip.assetId]).toMatchObject({ durationSec: 61.466667, width: 480, height: 854, aspect: '9:16' });
    expect(clip).toMatchObject({ startSec: 0, durationSec: 61.466667, sourceStartSec: 0, sourceDurationSec: 61.466667 });
    expect(before.tracks.every(t => !t.clips.length)).toBe(true);
  });
  it('preserves a populated composition format and appends within its target', () => {
    const before = insertSourceMediaOnTimeline(project(), { path: 'old', label: 'Old', kind: 'video', durationSec: 250 });
    const after = insertMeasuredSource(before, source), clip = inserted(after);
    expect(after.aspect).toBe('16:9'); expect(after.targetDurationSec).toBe(270);
    expect(clip).toMatchObject({ startSec: 250, durationSec: 20, sourceDurationSec: 20 });
    expect(after.assets[clip.assetId].durationSec).toBe(61.466667);
    expect(() => insertMeasuredSource(after, source)).toThrow('No room');
  });
  it('respects explicit source trim and clamps to the actual source end', () => {
    const p = insertMeasuredSource(project(), { ...source, sourceStartSec: 60, durationSec: 10 }), c = inserted(p);
    expect(c.sourceStartSec).toBe(60); expect(c.durationSec).toBeCloseTo(1.466667); expect(c.sourceDurationSec).toBe(c.durationSec);
    expect(p.assets[c.assetId].durationSec).toBe(61.466667);
  });
  it.each([0, -1, NaN, Infinity, undefined])('refuses unknown/invalid duration %s rather than inventing 30 seconds', durationSec => {
    expect(() => insertMeasuredSource(project(), { ...source, info: { ...source.info, durationSec } })).toThrow('duration');
  });
  it('refuses missing dimensions, invalid trims and locked tracks', () => {
    expect(() => insertMeasuredSource(project(), { ...source, info: { durationSec: 61 } })).toThrow('dimensions');
    expect(() => insertMeasuredSource(project(), { ...source, sourceStartSec: 62 })).toThrow('trim');
    const p = project(); p.tracks.find(t => t.kind === 'video')!.locked = true;
    expect(() => insertMeasuredSource(p, source)).toThrow('locked');
  });
  it('does not change format when a different lane is populated', () => {
    const p = insertSourceMediaOnTimeline(project(), { path: 'image', label: 'Existing', kind: 'image', durationSec: 5 });
    expect(insertMeasuredSource(p, source).aspect).toBe('16:9');
  });
});
