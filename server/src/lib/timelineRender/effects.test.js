import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeEffectClip,
  isSupportedEffect,
  buildTransitionFilter,
  TRANSITION_STYLES,
} from './effects.js';

describe('normalizeEffectClip', () => {
  test('reads the effect kind and defaults timings', () => {
    const c = normalizeEffectClip({ effect: 'transition', startSec: 5 });
    assert.equal(c.kind, 'transition');
    assert.equal(c.startSec, 5);
    assert.ok(c.durationSec > 0);
  });

  test('is case-insensitive and trims', () => {
    assert.equal(normalizeEffectClip({ effect: '  GLOW ' }).kind, 'glow');
  });

  test('never returns a negative start or zero duration', () => {
    const c = normalizeEffectClip({ effect: 'glow', startSec: -4, durationSec: 0 });
    assert.equal(c.startSec, 0);
    assert.ok(c.durationSec >= 0.1);
  });
});

describe('isSupportedEffect', () => {
  test('accepts the four documented effects', () => {
    for (const k of ['transition', 'glow', 'grade', 'lightleak']) {
      assert.equal(isSupportedEffect({ effect: k }), true, `${k} should be supported`);
    }
  });

  test('rejects anything else so it can be reported, not ignored', () => {
    assert.equal(isSupportedEffect({ effect: 'teleport' }), false);
    assert.equal(isSupportedEffect({}), false);
  });
});

describe('buildTransitionFilter', () => {
  test('emits an xfade between two labelled streams', () => {
    const f = buildTransitionFilter({
      clip: { effect: 'transition', startSec: 10, durationSec: 0.6, style: 'fade' },
      fromLabel: '[a]',
      toLabel: '[b]',
      outLabel: '[out]',
    });
    assert.match(f, /^\[a\]\[b\]xfade=/);
    assert.match(f, /transition=fade/);
    assert.match(f, /duration=0\.6/);
    assert.match(f, /offset=10/);
    assert.match(f, /\[out\]$/);
  });

  test('supports every documented style', () => {
    for (const style of Object.keys(TRANSITION_STYLES)) {
      const f = buildTransitionFilter({
        clip: { effect: 'transition', startSec: 1, durationSec: 0.5, style },
        fromLabel: '[a]', toLabel: '[b]', outLabel: '[o]',
      });
      assert.match(f, new RegExp(`transition=${TRANSITION_STYLES[style]}`));
    }
  });

  test('falls back to fade for an unknown style rather than emitting garbage', () => {
    const f = buildTransitionFilter({
      clip: { effect: 'transition', startSec: 1, durationSec: 0.5, style: 'nonsense' },
      fromLabel: '[a]', toLabel: '[b]', outLabel: '[o]',
    });
    assert.match(f, /transition=fade/);
  });

  test('clamps a transition longer than the outgoing clip can support', () => {
    const f = buildTransitionFilter({
      clip: { effect: 'transition', startSec: 2, durationSec: 30 },
      fromLabel: '[a]', toLabel: '[b]', outLabel: '[o]',
      maxDurationSec: 1.5,
    });
    const d = Number(/duration=([\d.]+)/.exec(f)[1]);
    assert.ok(d <= 1.5, `expected clamp to 1.5, got ${d}`);
  });

  test('never emits a zero or negative duration', () => {
    const f = buildTransitionFilter({
      clip: { effect: 'transition', startSec: 0, durationSec: 0 },
      fromLabel: '[a]', toLabel: '[b]', outLabel: '[o]',
    });
    const d = Number(/duration=([\d.]+)/.exec(f)[1]);
    assert.ok(d > 0);
  });
});
