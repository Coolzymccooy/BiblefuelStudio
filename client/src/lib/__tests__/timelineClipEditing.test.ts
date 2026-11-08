import { describe, expect, test } from 'vitest';
import { editClipTiming } from '../timelineClipEditing';
import { buildWorshipDocumentaryProject, insertAssetOnTrack, type TimelineTrackKind } from '../timelineProject';
import { composeVoiceTiming } from '../timelineTrackSync';

function fixture() {
  return insertAssetOnTrack(buildWorshipDocumentaryProject({ title: 'Clock' }), {
    trackKind: 'voiceover', startSec: 10, durationSec: 6,
    asset: { id: 'take', kind: 'audio', source: 'fish', label: 'take', path: 'take.wav', durationSec: 10,
      words: [{ text: 'Grace', startMs: 2000, endMs: 2600 }, { text: 'peace', startMs: 4000, endMs: 4600 }] },
  });
}
describe('numeric clip edits use existing source/composition clocks', () => {
  test.each(['video', 'broll', 'music', 'captions', 'effects'] as TimelineTrackKind[])('rejects every numeric clock on unsupported %s, without mutating the project', (kind) => {
    const p = fixture();
    // Use the same valid asset and in-bounds clocks: renderer capability, not
    // incidental validation or sidecar naming, must stop the direct caller.
    const track = p.tracks.find((t) => t.kind === 'voiceover')!;
    track.kind = kind;
    const clip = track.clips[0];
    const before = JSON.stringify(p);
    for (const timing of [
      { startSec: 12, sourceStartSec: 0, durationSec: 6 },
      { startSec: 10, sourceStartSec: 2, durationSec: 6 },
      { startSec: 10, sourceStartSec: 0, durationSec: 3 },
    ]) expect(editClipTiming(p, clip.id, timing)).toBe(p);
    expect(JSON.stringify(p)).toBe(before);
  });
  test('moves and trims without mutating words or unrelated project state', () => {
    const p = fixture(); const clip = p.tracks.find((t) => t.kind === 'voiceover')!.clips[0];
    const result = editClipTiming(p, clip.id, { startSec: 20.25, sourceStartSec: 2, durationSec: 3 });
    expect(result.assets).toBe(p.assets);
    expect(result.scenes).toBe(p.scenes);
    expect(p.tracks.find((t) => t.kind === 'voiceover')!.clips[0]).toBe(clip);
    expect(composeVoiceTiming(result)).toEqual({ startSec: 20.25, durationSec: 3, words: [{text:'Grace',startMs:0,endMs:600},{text:'peace',startMs:2000,endMs:2600}] });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
  test.each([
    [-1,0,2], [0,-1,2], [0,0,0], [0,0,NaN], [0,0,Infinity], [269,0,2], [0,9,2],
  ])('rejects invalid or out-of-bounds edit %s/%s/%s', (startSec,sourceStartSec,durationSec) => {
    const p=fixture();const clip=p.tracks.find(t=>t.kind==='voiceover')!.clips[0];
    expect(editClipTiming(p,clip.id,{startSec,sourceStartSec,durationSec})).toBe(p);
  });
  test.each(['locked','hidden','sidecar'])('does not edit %s state', (flag) => {
    const p=fixture();const track=p.tracks.find(t=>t.kind==='voiceover')!;
    if(flag==='sidecar')track.clips[0].id='clip-sidecar-sync-captions-0';else track[flag as 'locked'|'hidden']=true;
    expect(editClipTiming(p,track.clips[0].id,{startSec:5,sourceStartSec:0,durationSec:2})).toBe(p);
  });
  test('unknown media length permits only the known selected source window',()=>{
    const p=fixture();delete p.assets.take.durationSec;const c=p.tracks.find(t=>t.kind==='voiceover')!.clips[0];
    expect(editClipTiming(p,c.id,{startSec:2,sourceStartSec:5,durationSec:2})).toBe(p);
    expect(editClipTiming(p,c.id,{startSec:2,sourceStartSec:4,durationSec:2})).not.toBe(p);
    c.sourceStartSec=2;
    expect(editClipTiming(p,c.id,{startSec:2,sourceStartSec:1,durationSec:2})).toBe(p);
    expect(editClipTiming(p,c.id,{startSec:2,sourceStartSec:2,durationSec:2})).not.toBe(p);
  });
});
