import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { selectBackgroundsForScript, resolveAutoBackgrounds } from './autoBackground.js';

const christian = (id, cats) => ({ id, categories: cats, tags: cats });

describe('autoBackground — faith screening', () => {
  test('never selects a non-Christian religious background', () => {
    const pool = [
      { id: 'mosque1', categories: ['prayer'], query: 'mosque at sunset' },
      { id: 'temple1', categories: ['peace'], filename: 'hindu-temple.mp4' },
      christian('church1', ['prayer', 'candle']),
    ];
    const { backgrounds } = selectBackgroundsForScript({
      pool,
      script: { hook: 'Pray without ceasing.' },
      maxBackgrounds: 3,
    });
    const ids = backgrounds.map((b) => b.id);
    assert.ok(!ids.includes('mosque1'), 'must not select a mosque');
    assert.ok(!ids.includes('temple1'), 'must not select a hindu temple');
  });

  test('a pool of only non-Christian imagery yields no library picks', () => {
    const pool = [
      { id: 'm', query: 'mosque' },
      { id: 'b', query: 'buddha statue' },
    ];
    const { backgrounds } = selectBackgroundsForScript({ pool, script: { hook: 'Peace.' } });
    assert.equal(backgrounds.length, 0, 'should fall through to generation, not ship a mosque');
  });

  test('reports weak matches so callers can prefer generation', () => {
    const pool = [christian('celebrate1', ['celebration', 'sunshine'])];
    const r = selectBackgroundsForScript({
      pool,
      script: { hook: 'zzz nonsense unmatchable text' },
      maxBackgrounds: 1,
    });
    assert.equal(r.weakMatches, 1, 'a random fallback pick must be reported as weak');
    assert.equal(r.totalBeats, 1);
  });
});

describe('resolveAutoBackgrounds — generation on total mismatch', () => {
  test('generates when no beat matches the library mood', async () => {
    const pool = [christian('celebrate1', ['celebration'])];
    let called = false;
    const res = await resolveAutoBackgrounds({
      pool,
      script: { hook: 'zzz unmatchable qqq' },
      maxBackgrounds: 1,
      generateImage: async () => { called = true; return { ok: true, path: 'generated/img.png' }; },
    });
    assert.equal(called, true, 'should reach for generation rather than a mismatched clip');
    assert.equal(res.source, 'generated-no-match');
  });

  test('keeps library picks when generation fails — a post still goes out', async () => {
    const pool = [christian('celebrate1', ['celebration'])];
    const res = await resolveAutoBackgrounds({
      pool,
      script: { hook: 'zzz unmatchable qqq' },
      maxBackgrounds: 1,
      generateImage: async () => { throw new Error('provider down'); },
    });
    assert.equal(res.source, 'library', 'generation failure must not block the post');
    assert.deepEqual(res.backgroundIds, ['celebrate1']);
  });

  test('does NOT generate when the library genuinely matches the mood', async () => {
    const pool = [christian('peace1', ['peace', 'ocean'])];
    let called = false;
    const res = await resolveAutoBackgrounds({
      pool,
      script: { hook: 'Cast all your anxiety on Him.' },
      maxBackgrounds: 1,
      generateImage: async () => { called = true; return { ok: true, path: 'x.png' }; },
    });
    assert.equal(called, false, 'a real mood match should be used as-is');
    assert.equal(res.source, 'library');
  });
});
