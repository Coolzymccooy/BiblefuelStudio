import { describe, it, expect } from 'vitest';
import { buildWorshipDocumentaryProject } from '../timelineProject';
import { composeVoiceTiming, preserveMatchingWords, syncSidecarTracks, type TimedCaptionClip } from '../timelineTrackSync';

const words = [
  { text: 'one', startMs: 100, endMs: 300 },
  { text: 'two', startMs: 1200, endMs: 1700 },
  { text: 'three', startMs: 2300, endMs: 2800 },
];
describe('Timeline source-clock preservation', () => {
  function splitProject() {
    const p = buildWorshipDocumentaryProject({ title: 'split word reproduction' });
    p.assets.vo = { id: 'vo', kind: 'audio', source: 'upload', path: '/synthetic.wav', label: 'VO',
      words: [{ text: 'Grace', startMs: 800, endMs: 1200 }] };
    p.tracks.find((t) => t.kind === 'voiceover')!.clips = [
      { id: 'left', assetId: 'vo', startSec: 0, durationSec: 1, transform: { fit: 'cover' } },
      { id: 'right', assetId: 'vo', startSec: 1, sourceStartSec: 1, durationSec: 1, transform: { fit: 'cover' } },
    ];
    return p;
  }
  it('stitches Grace 0.8–1.2 split at 1 without invalidating unchanged authored text', () => {
    const p = splitProject();
    const before = JSON.stringify(p);
    const voice = composeVoiceTiming(p)!;
    expect(voice.words).toEqual([{ text: 'Grace', startMs: 800, endMs: 1200 }]);
    const synced = syncSidecarTracks(p, { musicPaths: [], captionLines: ['GRACE!'], voice });
    const caption = synced.tracks.find((t) => t.kind === 'captions')!.clips[0] as TimedCaptionClip;
    expect(caption.timingStatus).toBe('source');
    expect(caption.words).toEqual([{ text: 'GRACE!', startMs: 0, endMs: 400 }]);
    expect([caption.startSec, caption.durationSec]).toEqual([0.8, 0.4]);
    expect(JSON.stringify(p)).toBe(before);
  });
  it('stitches multiple moved/trimmed splits in clock order, not array order', () => {
    const p = splitProject();
    const track = p.tracks.find((t) => t.kind === 'voiceover')!;
    const base = track.clips[0];
    track.clips = [
      { ...base, id: 'last', startSec: 5.2, sourceStartSec: 1.1, durationSec: 0.05 },
      { ...base, id: 'first', startSec: 5, sourceStartSec: 0.9, durationSec: 0.1 },
      { ...base, id: 'middle', startSec: 5.1, sourceStartSec: 1, durationSec: 0.1 },
    ];
    const result = composeVoiceTiming(p)!;
    expect(result.words).toHaveLength(1);
    expect(result.words![0].startMs).toBeCloseTo(0);
    expect(result.words![0].endMs).toBeCloseTo(250);
  });
  it.each([
    ['composition gap', 1.1, 1],
    ['source gap', 1, 1.1],
    ['source overlap', 1, 0.9],
    ['composition overlap', 0.9, 1],
    ['repeated playback of the same fragment', 1, 0.8],
  ])('does not stitch %s', (_name, startSec, sourceStartSec) => {
    const p = splitProject();
    const clips = p.tracks.find((t) => t.kind === 'voiceover')!.clips;
    clips[1] = { ...clips[1], startSec, sourceStartSec };
    expect(composeVoiceTiming(p)!.words).toHaveLength(2);
    expect(preserveMatchingWords(composeVoiceTiming(p)!.words!, ['Grace'])).toBeNull();
  });
  it('retains deliberate consecutive repeated full-word playback', () => {
    const p = splitProject();
    const track = p.tracks.find((t) => t.kind === 'voiceover')!;
    const base = track.clips[0];
    track.clips = [
      { ...base, startSec: 0, sourceStartSec: 0.8, durationSec: 0.4 },
      { ...base, id: 'repeat', startSec: 0.4, sourceStartSec: 0.8, durationSec: 0.4 },
    ];
    const voice = composeVoiceTiming(p)!;
    expect(voice.words).toHaveLength(2);
    expect(preserveMatchingWords(voice.words!, ['Grace Grace'])).not.toBeNull();
  });
  it('never stitches same-text words from another asset, word index, or track', () => {
    for (const kind of ['asset', 'word', 'track']) {
      const p = splitProject();
      const track = p.tracks.find((t) => t.kind === 'voiceover')!;
      if (kind === 'asset') {
        p.assets.other = { ...p.assets.vo, id: 'other' };
        track.clips[1].assetId = 'other';
      } else if (kind === 'word') {
        p.assets.vo.words = [
          { text: 'Grace', startMs: 800, endMs: 1000 },
          { text: 'Grace', startMs: 1000, endMs: 1200 },
        ];
      } else {
        const right = track.clips.pop()!;
        p.tracks.push({ ...track, id: 'another-track', clips: [right] });
      }
      expect(composeVoiceTiming(p)!.words, kind).toHaveLength(2);
    }
  });
  it('does not stitch across an intervening muted clip', () => {
    const p = splitProject();
    const track = p.tracks.find((t) => t.kind === 'voiceover')!;
    track.clips.push({ ...track.clips[0], id: 'intervening', startSec: 0.95, durationSec: 0.05, muted: true });
    expect(composeVoiceTiming(p)!.words).toHaveLength(2);
  });
  it.each([
    ['John 3:16', 'John 316'], ['1.5', '15'], ['-1', '1'], ['+1', '1'],
    ['−1', '1'], ['±1', '1'], ['.5', '5'], ['-.5', '.5'],
    ['3:16', '3.16'], ['1,000', '1000'], ['1/2', '12'], ['1e-3', '1e3'],
    ['$1', '1'], ['1%', '1'],
    ['-$1', '$1'], ['<1', '1'], ['≤1', '1'], ['>1', '1'], ['≥1', '1'], ['≈1', '1'], ['~1', '1'], ['1+', '1'], ['1−', '1'], ['1×', '1'], ['1÷', '1'], ['1=', '1'], ['1‰', '1'], ['€1', '1'], ['1^', '1'], ['1√', '1'],
  ])('invalidates numeric changes %s → %s in both directions', (source, edited) => {
    const timed = (text: string) => text.split(' ').map((text, i) => ({ text, startMs: i * 500, endMs: i * 500 + 400 }));
    expect(preserveMatchingWords(timed(source), [edited])).toBeNull();
    expect(preserveMatchingWords(timed(edited), [source])).toBeNull();
  });
  it.each([
    ['Hello.', 'Hello!'], ['John 3:16', 'JOHN (3:16)!'], ['1.5', '(1.5)!'],
    ['-$1', '“-$1!”'], ['<1', '(<1)!'], ['≤1', '“≤1,”'], ['1%', '1%!'], ['≈1', '(≈1).'], ['1×', '“1×”'],
    ['-1', '“-1!”'], ['+.5', '(+.5)!'], ['1%', '(1%)!'],
  ])('retains timing but emits authored tokens for %s → %s', (source, edited) => {
    const original = source.split(' ').map((text, i) => ({ text, startMs: i * 500, endMs: i * 500 + 400 }));
    expect(preserveMatchingWords(original, [edited])).toEqual(original.map((w, i) => ({ ...w, text: edited.split(' ')[i] })));
  });
  it('invalidates insertion, deletion and replacement instead of shifting old words by index', () => {
    for (const text of ['one new two three', 'one three', 'one too three']) {
      expect(preserveMatchingWords(words, [text])).toBeNull();
    }
    expect(preserveMatchingWords(words, ['ONE, two', 'three!'])?.map((w) => [w.startMs, w.endMs]))
      .toEqual(words.map((w) => [w.startMs, w.endMs]));
  });
  it('retains pauses across multiple moved, split and trimmed clips without mutating source words', () => {
    const p = buildWorshipDocumentaryProject({ title: 'synthetic' });
    p.assets.vo = { id: 'vo', kind: 'audio', source: 'upload', path: '/synthetic.wav', label: 'VO', words };
    p.tracks.find((t) => t.kind === 'voiceover')!.clips = [
      { id: 'left', assetId: 'vo', startSec: 5, durationSec: 1, transform: { fit: 'cover' } },
      { id: 'right', assetId: 'vo', startSec: 10, durationSec: 1, sourceStartSec: 1, transform: { fit: 'cover' } },
      { id: 'trim', assetId: 'vo', startSec: 20, durationSec: 0.3, sourceStartSec: 2.5, transform: { fit: 'cover' } },
    ];
    const before = JSON.stringify(p);
    const voice = composeVoiceTiming(p)!;
    expect(voice.words).toEqual([
      words[0], { text: 'two', startMs: 5200, endMs: 5700 },
      { text: 'three', startMs: 15000, endMs: 15300 },
    ]);
    const state = { musicPaths: [], captionLines: ['one', 'two', 'three'], voice };
    const synced = syncSidecarTracks(p, state);
    const captions = synced.tracks.find((t) => t.kind === 'captions')!.clips as TimedCaptionClip[];
    expect(captions.map((c) => [c.startSec, c.durationSec])).toEqual([[5.1, 0.2], [10.2, 0.5], [20, 0.3]]);
    expect(captions.every((c) => c.timingStatus === 'source' && c.words?.length === 1)).toBe(true);
    expect(syncSidecarTracks(synced, state)).toBe(synced);
    expect(JSON.stringify(p)).toBe(before);
    const edited = syncSidecarTracks(synced, { ...state, captionLines: ['one inserted two three'] });
    const invalid = edited.tracks.find((t) => t.kind === 'captions')!.clips[0] as TimedCaptionClip;
    expect(invalid.timingStatus).toBe('unavailable');
    expect(invalid.words).toBeUndefined();
  });
  it('refreshes word timings even when text and outer cue boundaries did not change', () => {
    const p = buildWorshipDocumentaryProject({ title: 'synthetic' });
    const voice = { startSec: 0, durationSec: 3, words };
    const state = { musicPaths: [], captionLines: ['one two three'], voice };
    const first = syncSidecarTracks(p, state);
    const next = syncSidecarTracks(first, { ...state, voice: { ...voice, words: words.map((w, i) => i === 1 ? { ...w, startMs: 1400 } : w) } });
    expect(next).not.toBe(first);
  });
  it('keeps manual caption clips intact and reaches an idempotent state beside mirrored captions', () => {
    const p = buildWorshipDocumentaryProject({ title: 'manual' });
    p.assets.manual = { id: 'manual', kind: 'caption', source: 'system', label: 'Manual' };
    const manual = { id: 'manual', assetId: 'manual', text: 'manual', startSec: 25, durationSec: 1, transform: { fit: 'cover' as const } };
    p.tracks.find((t) => t.kind === 'captions')!.clips = [manual];
    const state = { musicPaths: [], captionLines: ['one two three'], voice: { startSec: 0, durationSec: 3, words } };
    const synced = syncSidecarTracks(p, state);
    expect(synced.tracks.find((t) => t.kind === 'captions')!.clips).toContain(manual);
    expect(syncSidecarTracks(synced, state)).toBe(synced);
  });
  it('labels timing-free legacy captions estimated', () => {
    const p = syncSidecarTracks(buildWorshipDocumentaryProject({ title: 'legacy' }), { musicPaths: [], captionLines: ['hello'] });
    expect((p.tracks.find((t) => t.kind === 'captions')!.clips[0] as TimedCaptionClip).timingStatus).toBe('estimated');
  });
});
