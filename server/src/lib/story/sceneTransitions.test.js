import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildXfadeChain, safeTransitionSec, DEFAULT_TRANSITION_SEC } from './sceneTransitions.js';

const segs = (...durations) => durations.map((durationSec, i) => ({ id: `s${i}`, durationSec }));

describe('safeTransitionSec', () => {
  test('uses the desired duration when both scenes are long enough', () => {
    assert.equal(safeTransitionSec(5, 5, 0.5), 0.5);
  });

  test('shortens rather than skips when a scene is brief', () => {
    // 0.9s scene: a 0.5s crossfade would eat more than half of it.
    const t = safeTransitionSec(0.9, 5, 0.5);
    assert.ok(t > 0 && t < 0.5, `expected a shortened transition, got ${t}`);
    assert.ok(t <= 0.3 + 1e-9, 'must not exceed a third of the shorter scene');
  });

  test('returns 0 for zero-length or invalid scenes', () => {
    assert.equal(safeTransitionSec(0, 5, 0.5), 0);
    assert.equal(safeTransitionSec(5, 0, 0.5), 0);
    assert.equal(safeTransitionSec(NaN, 5, 0.5), 0);
  });
});

describe('buildXfadeChain — timing integrity', () => {
  test('preserves TOTAL runtime so video stays in sync with narration', () => {
    const list = segs(4, 4, 4);
    const { paddedDurations, transitions } = buildXfadeChain(list, { transitionSec: 0.5 });
    const originalTotal = 12;
    const paddedTotal = paddedDurations.reduce((a, b) => a + b, 0);
    const consumed = transitions.reduce((a, t) => a + t.durationSec, 0);
    assert.equal(Number((paddedTotal - consumed).toFixed(3)), originalTotal,
      'padded total minus crossfade overlap must equal the original duration');
  });

  test('pads every scene except the last', () => {
    const { paddedDurations } = buildXfadeChain(segs(4, 4, 4), { transitionSec: 0.5 });
    assert.deepEqual(paddedDurations, [4.5, 4.5, 4]);
  });

  test('offsets accumulate along the original timeline', () => {
    const { transitions } = buildXfadeChain(segs(4, 3, 5), { transitionSec: 0.5 });
    assert.equal(transitions[0].offsetSec, 4, 'first crossfade starts at the end of scene 1');
    assert.equal(transitions[1].offsetSec, 7, 'second starts after scenes 1+2');
  });

  test('emits one filter per junction, ending at [vcat]', () => {
    const { filters, outLabel } = buildXfadeChain(segs(4, 4, 4, 4));
    assert.equal(filters.length, 3, 'four scenes = three junctions');
    assert.equal(outLabel, '[vcat]');
    assert.match(filters[filters.length - 1], /\[vcat\]$/);
  });

  test('chains labels so each xfade consumes the previous output', () => {
    const { filters } = buildXfadeChain(segs(4, 4, 4));
    assert.match(filters[0], /^\[s0\]\[s1\]xfade/);
    assert.match(filters[1], /^\[x0\]\[s2\]xfade/);
  });
});

describe('buildXfadeChain — edge cases', () => {
  test('a single scene needs no transition', () => {
    const r = buildXfadeChain(segs(6));
    assert.deepEqual(r.filters, []);
    assert.equal(r.outLabel, '[s0]');
    assert.deepEqual(r.paddedDurations, [6]);
  });

  test('handles an empty scene list', () => {
    const r = buildXfadeChain([]);
    assert.deepEqual(r.filters, []);
    assert.deepEqual(r.paddedDurations, []);
  });

  test('very short scenes still get a usable (shortened) crossfade', () => {
    const { transitions, paddedDurations } = buildXfadeChain(segs(0.6, 0.6), { transitionSec: 0.5 });
    assert.ok(transitions[0].durationSec > 0, 'should shorten, not drop');
    assert.ok(transitions[0].durationSec <= 0.2 + 1e-9);
    assert.ok(paddedDurations[0] > 0.6, 'first scene padded');
  });

  test('respects a custom transition type', () => {
    const { filters } = buildXfadeChain(segs(4, 4), { transition: 'dissolve' });
    assert.match(filters[0], /transition=dissolve/);
  });

  test('default transition duration is the documented constant', () => {
    const { transitions } = buildXfadeChain(segs(9, 9));
    assert.equal(transitions[0].durationSec, DEFAULT_TRANSITION_SEC);
  });
});
