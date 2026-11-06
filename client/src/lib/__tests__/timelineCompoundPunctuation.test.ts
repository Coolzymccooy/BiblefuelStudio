import { it, expect } from 'vitest';
import { preserveMatchingWords, timeCaptionLines, syncSidecarTracks, type TimedCaptionClip } from '../timelineTrackSync';
import { buildWorshipDocumentaryProject } from '../timelineProject';
const timed = (texts: string[]) => texts.map((text, i) => ({ text, startMs: i * 700 + 50, endMs: i * 700 + 400 }));
it.each(['—', '–', '‐', '‑', '‒', '―', '-', '…', '— ! ? …', '” ) , ; :'])('preserves compound %s without punctuation spans or stealing the next line', (punctuation) => {
  const original = timed(['Studio —', 'Fuel', 'Your']);
  const before = JSON.stringify(original);
  const lines = [`“ Studio ${punctuation} Fuel !`, 'Your !'];
  const mapped = preserveMatchingWords(original, lines);
  expect(mapped).toEqual([{ ...original[0], text: `“ Studio ${punctuation}` }, { ...original[1], text: 'Fuel !' }, { ...original[2], text: 'Your !' }]);
  const voice = { startSec: 5, durationSec: 3, words: original };
  expect(timeCaptionLines(lines, 30, voice)).toEqual([{ startSec: 5.05, durationSec: 1.05 }, { startSec: 6.45, durationSec: 0.35 }]);
  const project = syncSidecarTracks(buildWorshipDocumentaryProject({ title: 'compound' }), { musicPaths: [], captionLines: lines, voice });
  const clips = project.tracks.find((t) => t.kind === 'captions')!.clips as TimedCaptionClip[];
  expect(clips.map((c) => c.words?.length)).toEqual([2, 1]);
  expect(clips.every((c) => c.timingStatus === 'source')).toBe(true);
  expect(clips[1].words![0].text).toBe('Your !');
  expect(JSON.stringify(original)).toBe(before);
});
it.each([
  [['Studio Fuel', 'Your'], 'Studio Your'],
  [['Studio —', 'Fuel', 'Your'], 'Studio — Your'],
  [['Studio —', 'Fuel'], 'Studio — new Fuel'],
  [['Studio —', 'Fuel'], 'Fuel — Studio'],
  [['John', '3:16 —'], 'John 316 —'],
  [['John', '3:16 —'], 'John 3.16 —'],
  [['Cost', '-$1 —'], 'Cost $1 —'],
  [['Cost', '<1 —'], 'Cost 1 —'],
  [['Cost', '1 —'], 'Cost € 1 —'],
  [['Cost', '$', '1'], 'Cost 1'],
  [['Studio', '—', 'Fuel'], 'Studio — Fuel'],
  [['Studio —', 'Fuel'], '— !'],
] as Array<[string[], string]>)('fails closed %j -> %s', (source, text) => {
  expect(preserveMatchingWords(timed(source), [text])).toBeNull();
});
