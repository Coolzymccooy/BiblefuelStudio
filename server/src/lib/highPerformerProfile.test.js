import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickScriptType,
  isReadableOnscreen,
  trimToReadable,
  PROBLEM_LED_SCRIPT_TYPES,
  MAX_ONSCREEN_CHARS,
} from './highPerformerProfile.js';

describe('pickScriptType', () => {
  test('rotates rather than pinning to one bucket', () => {
    const first = Array.from({ length: PROBLEM_LED_SCRIPT_TYPES.length }, (_, i) => pickScriptType(i));
    assert.equal(new Set(first).size, PROBLEM_LED_SCRIPT_TYPES.length,
      'a full cycle should cover every type — this is the fix for scriptType being pinned to "peace"');
  });

  test('is deterministic for a given index', () => {
    assert.equal(pickScriptType(3), pickScriptType(3));
  });

  test('wraps past the end of the rotation', () => {
    assert.equal(pickScriptType(PROBLEM_LED_SCRIPT_TYPES.length), pickScriptType(0));
  });

  test('handles negative and non-numeric input without throwing', () => {
    assert.ok(PROBLEM_LED_SCRIPT_TYPES.includes(pickScriptType(-5)));
    assert.ok(PROBLEM_LED_SCRIPT_TYPES.includes(pickScriptType(undefined)));
    assert.ok(PROBLEM_LED_SCRIPT_TYPES.includes(pickScriptType('x')));
  });

  test('every rotated type is one generateScripts understands', () => {
    const known = ['peace','strength','anxiety','identity','prayer','gratitude','forgiveness','purpose','healing'];
    for (const t of PROBLEM_LED_SCRIPT_TYPES) assert.ok(known.includes(t), `unknown scriptType: ${t}`);
  });
});

describe('onscreen text limits', () => {
  test('accepts a short hero line', () => {
    assert.equal(isReadableOnscreen('You are not alone.'), true);
  });

  test('rejects a wall of text like the low-performing posts', () => {
    const wall = 'Feeling weak? You are not alone. God’s strength is made perfect in our weakness. '
      + '(2 Corinthians 12:9) Embrace your vulnerabilities; they are where God’s power shines brightest.';
    assert.equal(isReadableOnscreen(wall), false);
  });

  test('trims on a word boundary, never mid-word', () => {
    const wall = 'a'.repeat(40) + ' ' + 'b'.repeat(40) + ' ' + 'c'.repeat(40);
    const out = trimToReadable(wall);
    assert.ok(out.length <= MAX_ONSCREEN_CHARS);
    assert.ok(!out.endsWith('b'.repeat(3) + 'c'), 'must not slice a word in half');
    assert.ok(!/\s$/.test(out), 'no trailing whitespace');
  });

  test('leaves already-short text untouched', () => {
    assert.equal(trimToReadable('Delay is not denial.'), 'Delay is not denial.');
  });

  test('handles empty and nullish input', () => {
    assert.equal(trimToReadable(''), '');
    assert.equal(trimToReadable(null), '');
    assert.equal(trimToReadable(undefined), '');
  });
});
