import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { describeRenderCoverage } from './coverage.js';

const plan = (tracks) => ({ tracks });
const clip = (id, extra = {}) => ({ id, path: `/a/${id}.mp4`, ...extra });

describe('describeRenderCoverage', () => {
  test('reports tracks that made it into the render', () => {
    const r = describeRenderCoverage(plan([
      { kind: 'video', clips: [clip('v1')] },
      { kind: 'music', clips: [clip('m1')] },
    ]));
    const kinds = r.included.map((i) => i.kind);
    assert.ok(kinds.includes('video'));
    assert.ok(kinds.includes('music'), 'music is composed now and must be reported as included');
  });

  test('warns when an effects clip is dropped — the track is not composed', () => {
    const r = describeRenderCoverage(plan([
      { kind: 'video', clips: [clip('v1')] },
      { kind: 'effects', clips: [clip('e1'), clip('e2')] },
    ]));
    assert.equal(r.omitted.length, 1);
    assert.equal(r.omitted[0].count, 2);
    assert.match(r.warnings[0], /Effects/);
    assert.match(r.warnings[0], /not composed by the renderer yet/);
  });

  test('warns when a capped track has more clips than the cap', () => {
    const r = describeRenderCoverage(plan([
      { kind: 'music', clips: [clip('m1'), clip('m2'), clip('m3')] },
    ]));
    const musicOmission = r.omitted.find((o) => o.kind === 'music');
    assert.ok(musicOmission, 'extra music clips beyond the cap must be reported');
    assert.equal(musicOmission.count, 2);
  });

  test('warns about clips with no media yet', () => {
    const r = describeRenderCoverage(plan([
      { kind: 'voiceover', clips: [clip('vo1'), { id: 'vo2' }] },
    ]));
    const o = r.omitted.find((x) => x.reason === 'clip has no media file yet');
    assert.ok(o);
    assert.equal(o.count, 1);
  });

  test('a placeholder WITH a prompt still counts as usable', () => {
    // Voice-over placeholders are synthesized during render, so a prompt is enough.
    const r = describeRenderCoverage(plan([
      { kind: 'voiceover', clips: [{ id: 'vo1', prompt: 'Welcome to the house of God' }] },
    ]));
    assert.equal(r.omitted.length, 0);
    assert.equal(r.included.find((i) => i.kind === 'voiceover').used, 1);
  });

  test('a clean plan produces no warnings', () => {
    const r = describeRenderCoverage(plan([
      { kind: 'video', clips: [clip('v1')] },
      { kind: 'broll', clips: [clip('b1'), clip('b2')] },
    ]));
    assert.deepEqual(r.warnings, []);
  });

  test('caption clips count as usable via TEXT, not a media path', () => {
    const r = describeRenderCoverage(plan([
      { kind: 'captions', clips: [{ id: 'c1', text: 'He is worthy' }, { id: 'c2', text: '  ' }] },
    ]));
    assert.equal(r.included.find((i) => i.kind === 'captions').used, 1);
    const o = r.omitted.find((x) => x.kind === 'captions');
    assert.equal(o.count, 1, 'only the blank caption is unusable');
  });

  test('handles an empty or malformed plan without throwing', () => {
    assert.deepEqual(describeRenderCoverage({}).warnings, []);
    assert.deepEqual(describeRenderCoverage(null).warnings, []);
    assert.deepEqual(describeRenderCoverage(plan([])).warnings, []);
  });

  test('broll and voiceover are no longer capped', () => {
    const r = describeRenderCoverage(plan([
      { kind: 'broll', clips: [clip('b1'), clip('b2'), clip('b3'), clip('b4')] },
      { kind: 'voiceover', clips: [clip('v1'), clip('v2'), clip('v3'), clip('v4'), clip('v5'), clip('v6')] },
    ]));
    assert.deepEqual(r.warnings, [], 'the old slice(0,1)/slice(0,4) caps should be gone');
    assert.equal(r.included.find((i) => i.kind === 'broll').used, 4);
    assert.equal(r.included.find((i) => i.kind === 'voiceover').used, 6);
  });
});
