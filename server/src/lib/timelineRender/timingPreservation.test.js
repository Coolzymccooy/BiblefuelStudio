import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildTimelineRenderPlan } from './planner.js';
import { captionRendererInput, buildCaptionClipsFromWords } from './captions.js';
import { buildProofRenderCommand } from './proofRenderer.js';
import { _setLibassForTest } from '../kinetic/capability.js';

const changedNumeric = [['-$1', '$1'], ['<1', '1'], ['≤1', '1'], ['>1', '1'], ['≥1', '1'], ['≈1', '1'], ['~1', '1'], ['1+', '1'], ['1−', '1'], ['1×', '1'], ['1÷', '1'], ['1=', '1'], ['1‰', '1'], ['€1', '1'], ['1^', '1'], ['1√', '1']];
const matchedNumeric = [['-$1', '“-$1!”'], ['<1', '(<1)!'], ['≤1', '“≤1,”'], ['1%', '1%!'], ['≈1', '(≈1).'], ['1×', '“1×”']];
for (const [source, edited] of changedNumeric) test(`numeric meaning ${source} -> ${edited} refuses both ways`, () => {
  for (const [from, to] of [[source, edited], [edited, source]]) {
    assert.deepEqual(captionRendererInput({ text: to, words: [{ text: from, startMs: 0, endMs: 400 }], durationSec: 1 }), { timingStatus: 'unavailable', words: [] });
  }
});
for (const [source, edited] of matchedNumeric) test(`numeric formatting ${source} -> ${edited} retains spans`, () => {
  assert.deepEqual(captionRendererInput({ text: edited, words: [{ text: source, startMs: 100, endMs: 400 }], durationSec: 1 }).words, [{ text: edited, start: 0.1, end: 0.4 }]);
});
const words = [
  { text: 'first', startMs: 100, endMs: 300 },
  { text: 'pause', startMs: 1400, endMs: 1700 },
  { text: 'last', startMs: 2600, endMs: 2900 },
];
function project() {
  return { id: 'synthetic-clock', title: 'Clock', aspect: '16:9', assets: {
    video: { kind: 'video', path: 'synthetic/main.mp4' },
    vo: { kind: 'audio', path: 'synthetic/voice.wav', words },
    captions: { kind: 'caption' },
  }, tracks: [
    { kind: 'video', clips: [{ id: 'main', assetId: 'video', startSec: 0, durationSec: 15 }] },
    { kind: 'voiceover', clips: [
      { id: 'vo-a', assetId: 'vo', startSec: 2, durationSec: 1 },
      { id: 'vo-b', assetId: 'vo', startSec: 8, sourceStartSec: 1, durationSec: 1 },
    ] },
    { kind: 'captions', clips: [
      { id: 'caption-a', assetId: 'captions', text: 'first pause last', words, startSec: 2, durationSec: 1 },
      { id: 'caption-b', assetId: 'captions', text: 'first pause last', words, startSec: 8, sourceStartSec: 1, durationSec: 1 },
    ] },
  ] };
}
const opts = { serverRoot: process.cwd(), outputDir: path.resolve(process.env.TMPDIR || process.cwd()), outputPath: path.resolve(process.env.TMPDIR || process.cwd(), 'synthetic-clock.mp4') };
test('numeric VO timing contract reaches the actual proof renderer source trim and composition delay without rewriting source words', () => {
  const p = project();
  p.targetDurationSec = 30;
  p.assets.vo.durationSec = 10;
  p.tracks[1].clips = [{ id: 'numeric-vo', assetId: 'vo', startSec: 20.25, sourceStartSec: 2, durationSec: 3 }];
  const original = JSON.stringify(p);
  const plan = buildTimelineRenderPlan(JSON.parse(original));
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.tracks.find((t) => t.kind === 'voiceover').clips[0].words, words);
  const command = buildProofRenderCommand(plan, opts);
  assert.equal(command.ok, true);
  const graph = command.args[command.args.indexOf('-filter_complex') + 1];
  assert.match(graph, /atrim=start=2:duration=3,asetpts=PTS-STARTPTS,adelay=20250\|20250/);
  assert.equal(JSON.stringify(p), original);
});
test('authored Hello! survives serialization, planner, drawtext and Studio ASS with original timing', () => {
  const p = project();
  p.tracks[2].clips = [{ id: 'authored-punctuation', assetId: 'captions', text: 'Hello!',
    words: [{ text: 'Hello.', startMs: 100, endMs: 400 }], startSec: 2, durationSec: 1, timingStatus: 'source' }];
  const serialized = JSON.stringify(p);
  const plan = buildTimelineRenderPlan(JSON.parse(serialized));
  assert.equal(plan.ok, true);
  const expected = [{ text: 'Hello!', start: 2.1, end: 2.4 }];
  const fallback = buildProofRenderCommand(plan, opts);
  assert.equal(fallback.ok, true);
  assert.deepEqual(fallback.captionTiming[0].words, expected);
  const graph = fallback.args[fallback.args.indexOf('-filter_complex') + 1];
  assert.match(graph, /Hello!/i);
  assert.doesNotMatch(graph, /Hello\./i);
  _setLibassForTest(true);
  try {
    const studio = buildProofRenderCommand(plan, { ...opts, typographyPreset: 'studio-clean-white' });
    assert.equal(studio.ok, true);
    assert.deepEqual(studio.captionTiming[0].words, expected);
    assert.equal(studio.sideFiles.length, 1);
    assert.match(studio.sideFiles[0].text, /HELLO!/);
    assert.doesNotMatch(studio.sideFiles[0].text, /HELLO\./);
  } finally { _setLibassForTest(null); }
  assert.equal(JSON.stringify(p), serialized);
});

test('native word data survives project serialization, planner and exact renderer input with split source offsets', () => {
  const p = project();
  const original = JSON.stringify(p);
  const plan = buildTimelineRenderPlan(JSON.parse(original));
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.tracks.find((t) => t.kind === 'voiceover').clips[1].words, words);
  const cmd = buildProofRenderCommand(plan, opts);
  assert.equal(cmd.ok, true);
  assert.deepEqual(cmd.captionTiming.map((c) => c.words), [
    [{ text: 'first', start: 2.1, end: 2.3 }],
    [{ text: 'pause', start: 8.4, end: 8.7 }],
  ]);
  const graph = cmd.args[cmd.args.indexOf('-filter_complex') + 1];
  assert.match(graph, /atrim=start=0:duration=1,asetpts=PTS-STARTPTS,adelay=2000\|2000/);
  assert.match(graph, /atrim=start=1:duration=1,asetpts=PTS-STARTPTS,adelay=8000\|8000/);
  assert.equal(JSON.stringify(p), original);
});
test('trim clips crossing words using the same source boundary; edited insertion/deletion invalidates timing', () => {
  const clip = { text: 'first pause last', words, startSec: 10, sourceStartSec: 1.5, durationSec: 0.1 };
  const input = captionRendererInput(clip);
  assert.equal(input.words.length, 1);
  assert.equal(input.words[0].start, 10);
  assert.ok(Math.abs(input.words[0].end - 10.1) < 1e-9);
  for (const text of ['first new pause last', 'first last', 'first changed last']) {
    assert.deepEqual(captionRendererInput({ ...clip, text }), { timingStatus: 'unavailable', words: [] });
  }
  assert.equal(captionRendererInput({ text: 'legacy', startSec: 2, durationSec: 1 }).timingStatus, 'estimated');
});
test('caption grouping stores local source times, not a second composition offset', () => {
  const clips = buildCaptionClipsFromWords(words, { maxWordsPerClip: 1 });
  assert.equal(clips[1].words[0].startMs, 0);
  assert.equal(captionRendererInput(clips[1]).words[0].start, 1.4);
});
test('Studio ASS receives native irregular word times instead of uniformly rephrasing them', () => {
  _setLibassForTest(true);
  try {
    const p = project();
    p.tracks[2].clips = [{ id: 'full', assetId: 'captions', text: 'first pause last', words, startSec: 2, durationSec: 3 }];
    const cmd = buildProofRenderCommand(buildTimelineRenderPlan(p), { ...opts, typographyPreset: 'studio-clean-white' });
    assert.equal(cmd.ok, true);
    assert.equal(cmd.sideFiles.length, 1);
    // The ASS contains exact native speech entrances (not 2, 3, 4 uniform pacing).
    assert.match(cmd.sideFiles[0].text, /\\t\(1300,1370,/);
    assert.doesNotMatch(cmd.sideFiles[0].text, /0:00:06\.10/);
    assert.match(cmd.sideFiles[0].text, /0:00:05\.00/);
    assert.deepEqual(cmd.captionTiming[0].words.map((w) => w.start), [2.1, 3.4, 4.6]);
  } finally { _setLibassForTest(null); }
});
test('mixed native and legacy cues share one ASS without dropping either cue', () => {
  _setLibassForTest(true);
  try {
    const p = project();
    delete p.tracks[2].clips[1].words;
    p.tracks[2].clips[1].text = 'legacy text';
    const cmd = buildProofRenderCommand(buildTimelineRenderPlan(p), { ...opts, typographyPreset: 'studio-clean-white' });
    assert.equal(cmd.sideFiles.length, 1);
    assert.match(cmd.sideFiles[0].text, /FIRST/);
    assert.match(cmd.sideFiles[0].text, /LEGACY/);
    assert.deepEqual(cmd.captionTiming.map((c) => c.timingStatus), ['source', 'estimated']);
    for (const line of cmd.sideFiles[0].text.split('\n').filter((s) => s.startsWith('Dialogue:'))) {
      const fields = line.split(',');
      const toSec = (s) => s.split(':').reduce((n, part) => n * 60 + Number(part), 0);
      const start = toSec(fields[1]);
      const end = toSec(fields[2]);
      assert.ok(end <= (start < 3 ? 3 : 9));
    }
  } finally { _setLibassForTest(null); }
});
test('missing and stale timing is explicitly reported estimated/unavailable', () => {
  const p = project();
  delete p.tracks[2].clips[0].words;
  p.tracks[2].clips[1].text = 'new text';
  const cmd = buildProofRenderCommand(buildTimelineRenderPlan(p), opts);
  assert.deepEqual(cmd.captionTiming.map((c) => c.timingStatus), ['estimated', 'unavailable']);
  assert.ok(cmd.warnings.some((w) => /estimated/.test(w)));
  assert.ok(cmd.warnings.some((w) => /unavailable/.test(w)));
});
