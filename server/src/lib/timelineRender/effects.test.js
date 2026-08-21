import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeEffectClip,
  isSupportedEffect,
  buildTransitionFilter,
  buildGlowFilter,
  buildGradeFilter,
  TRANSITION_STYLES,
  GRADE_LOOKS,
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

describe('buildGlowFilter', () => {
  test('emits a timed bloom that returns to the caller label', () => {
    const f = buildGlowFilter({
      clip: { effect: 'glow', startSec: 4, durationSec: 3 },
      inLabel: '[v0]',
      outLabel: '[v1]',
    });
    assert.match(f, /^\[v0\]/);
    assert.match(f, /\[v1\]$/);
    // A bloom is a blurred, brightened copy blended back over the original.
    assert.match(f, /gblur|boxblur/);
    assert.match(f, /blend|overlay/);
  });

  test('is time-gated so it does not glow for the whole video', () => {
    const f = buildGlowFilter({
      clip: { effect: 'glow', startSec: 4, durationSec: 3 },
      inLabel: '[v0]', outLabel: '[v1]',
    });
    assert.match(f, /enable='between\(t,4,7\)'/);
  });

  test('intensity is clamped to a sane range', () => {
    const hot = buildGlowFilter({
      clip: { effect: 'glow', startSec: 0, durationSec: 1, intensity: 99 },
      inLabel: '[a]', outLabel: '[b]',
    });
    const opacity = Number(/all_opacity=([\d.]+)/.exec(hot)[1]);
    assert.ok(opacity <= 1, `opacity must stay <= 1, got ${opacity}`);

    const cold = buildGlowFilter({
      clip: { effect: 'glow', startSec: 0, durationSec: 1, intensity: -5 },
      inLabel: '[a]', outLabel: '[b]',
    });
    const lowOpacity = Number(/all_opacity=([\d.]+)/.exec(cold)[1]);
    assert.ok(lowOpacity >= 0, 'opacity must not go negative');
  });

  test('a stronger intensity produces a stronger blend than a weaker one', () => {
    const weak = Number(/all_opacity=([\d.]+)/.exec(buildGlowFilter({
      clip: { effect: 'glow', startSec: 0, durationSec: 1, intensity: 0.2 },
      inLabel: '[a]', outLabel: '[b]' })) [1]);
    const strong = Number(/all_opacity=([\d.]+)/.exec(buildGlowFilter({
      clip: { effect: 'glow', startSec: 0, durationSec: 1, intensity: 0.9 },
      inLabel: '[a]', outLabel: '[b]' })) [1]);
    assert.ok(strong > weak, 'intensity must actually change the result');
  });

  test('labels are unique per index so several glows can chain', () => {
    const a = buildGlowFilter({ clip: { effect: 'glow' }, inLabel: '[v0]', outLabel: '[v1]', index: 0 });
    const b = buildGlowFilter({ clip: { effect: 'glow' }, inLabel: '[v1]', outLabel: '[v2]', index: 1 });
    assert.notEqual(a, b);
    assert.doesNotMatch(b, /\[gb0\]/, 'index 1 must not reuse index 0 intermediate labels');
  });
});

describe('buildGradeFilter', () => {
  test('emits an eq filter gated to the clip window', () => {
    const f = buildGradeFilter({
      clip: { effect: 'grade', startSec: 2, durationSec: 5, look: 'warm' },
      inLabel: '[v0]', outLabel: '[v1]',
    });
    assert.match(f, /^\[v0\]/);
    assert.match(f, /\[v1\]$/);
    assert.match(f, /eq=/);
    assert.match(f, /enable='between\(t,2,7\)'/);
  });

  test('every documented look produces a distinct grade', () => {
    const seen = new Set();
    for (const look of Object.keys(GRADE_LOOKS)) {
      const f = buildGradeFilter({
        clip: { effect: 'grade', startSec: 0, durationSec: 1, look },
        inLabel: '[a]', outLabel: '[b]',
      });
      assert.doesNotMatch(f, /undefined|NaN/, `${look} produced an invalid parameter`);
      seen.add(f);
    }
    assert.equal(seen.size, Object.keys(GRADE_LOOKS).length, 'looks must differ from each other');
  });

  test('warm and cool push colour in opposite directions', () => {
    const warm = buildGradeFilter({ clip: { effect: 'grade', look: 'warm' }, inLabel: '[a]', outLabel: '[b]' });
    const cool = buildGradeFilter({ clip: { effect: 'grade', look: 'cool' }, inLabel: '[a]', outLabel: '[b]' });
    const warmR = Number(/gamma_r=([\d.]+)/.exec(warm)[1]);
    const coolR = Number(/gamma_r=([\d.]+)/.exec(cool)[1]);
    assert.ok(warmR > coolR, 'warm must lift red relative to cool');
  });

  test('an unknown look falls back instead of emitting invalid params', () => {
    const f = buildGradeFilter({
      clip: { effect: 'grade', look: 'neon-dragon' }, inLabel: '[a]', outLabel: '[b]',
    });
    assert.doesNotMatch(f, /undefined|NaN/);
    assert.match(f, /eq=/);
  });

  test('custom overrides beat the named look', () => {
    const f = buildGradeFilter({
      clip: { effect: 'grade', look: 'warm', saturation: 2.0 },
      inLabel: '[a]', outLabel: '[b]',
    });
    assert.match(f, /saturation=2/);
  });

  test('saturation and contrast are clamped to ffmpeg-valid ranges', () => {
    const f = buildGradeFilter({
      clip: { effect: 'grade', saturation: 99, contrast: -99 },
      inLabel: '[a]', outLabel: '[b]',
    });
    const sat = Number(/saturation=([\d.]+)/.exec(f)[1]);
    const con = Number(/contrast=(-?[\d.]+)/.exec(f)[1]);
    assert.ok(sat <= 3, `saturation out of range: ${sat}`);
    assert.ok(con >= -2, `contrast out of range: ${con}`);
  });
});
