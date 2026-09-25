import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { screenText, isFaithAppropriate, filterPool, safeSearchQuery } from './faithFilter.js';

describe('screenText — blocks non-Christian religious markers', () => {
  for (const t of ['mosque at sunset', 'islamic calligraphy', 'muslim man praying',
                   'hindu temple festival', 'buddha statue', 'sikh gurdwara',
                   'synagogue interior', 'tarot cards', 'chakra meditation']) {
    test(`blocks: ${t}`, () => assert.equal(screenText(t).blocked, true, `should block "${t}"`));
  }

  test('reports which term matched, for logging', () => {
    assert.equal(screenText('beautiful mosque').term, 'mosque');
  });
});

describe('screenText — allows Christian and neutral imagery', () => {
  for (const t of ['christian prayer', 'church worship service', 'bible open on table',
                   'cross at sunrise', 'candle light', 'ocean waves', 'mountain sunrise',
                   'woman praying hands', 'crucifix', 'communion bread and wine',
                   'sunset clouds', 'starry night sky']) {
    test(`allows: ${t}`, () => assert.equal(screenText(t).blocked, false, `should allow "${t}"`));
  }

  test('does not block "temple" — biblical and anatomical', () => {
    assert.equal(screenText('the temple in jerusalem').blocked, false);
  });

  test('does not block shared Christian vocabulary', () => {
    assert.equal(screenText('prayer').blocked, false);
    assert.equal(screenText('worship').blocked, false);
  });

  test('matches whole words only — no substring false positives', () => {
    assert.equal(screenText('homage to the homeless').blocked, false);
    assert.equal(screenText('omelette').blocked, false, '"om" must not fire inside "omelette"');
    assert.equal(screenText('monkey bars').blocked, false, '"monk" must not fire inside "monkey"');
  });

  test('empty and nullish input is not blocked', () => {
    assert.equal(screenText('').blocked, false);
    assert.equal(screenText(null).blocked, false);
    assert.equal(screenText(undefined).blocked, false);
  });
});

describe('isFaithAppropriate — scans every text field on an item', () => {
  test('blocks via tags', () => {
    assert.equal(isFaithAppropriate({ id: 'bg1', tags: ['peace', 'mosque'] }), false);
  });
  test('blocks via filename', () => {
    assert.equal(isFaithAppropriate({ id: 'bg2', filename: 'buddha-statue-4k.mp4' }), false);
  });
  test('blocks via original search query', () => {
    assert.equal(isFaithAppropriate({ id: 'bg3', query: 'hindu festival' }), false);
  });
  test('allows a clean Christian item', () => {
    assert.equal(isFaithAppropriate({ id: 'bg4', query: 'christian worship', tags: ['worship', 'light'] }), true);
  });
});

describe('filterPool', () => {
  const pool = [
    { id: 'a', tags: ['ocean', 'peace'] },
    { id: 'b', query: 'mosque interior' },
    { id: 'c', tags: ['worship', 'candle'] },
    { id: 'd', filename: 'hindu-diwali.mp4' },
  ];

  test('keeps only appropriate items', () => {
    const { kept } = filterPool(pool);
    assert.deepEqual(kept.map((i) => i.id), ['a', 'c']);
  });

  test('reports what was removed and why', () => {
    const { removed } = filterPool(pool);
    assert.equal(removed.length, 2);
    assert.equal(removed[0].term, 'mosque');
  });

  test('handles empty and nullish pools', () => {
    assert.deepEqual(filterPool([]).kept, []);
    assert.deepEqual(filterPool(null).kept, []);
  });
});

describe('safeSearchQuery', () => {
  test('refuses a query that explicitly asks for non-Christian imagery', () => {
    const r = safeSearchQuery('mosque at night');
    assert.equal(r.ok, false);
    assert.match(r.reason, /non-christian/i);
  });

  test('adds a Christian qualifier to ambiguous religious terms', () => {
    assert.equal(safeSearchQuery('prayer hands').query, 'christian prayer hands');
    assert.equal(safeSearchQuery('worship').query, 'christian worship');
  });

  test('does not double-qualify an already-Christian query', () => {
    assert.equal(safeSearchQuery('christian prayer').query, 'christian prayer');
    assert.equal(safeSearchQuery('jesus praying').query, 'jesus praying');
  });

  test('leaves neutral scenery untouched', () => {
    assert.equal(safeSearchQuery('sunrise clouds').query, 'sunrise clouds');
    assert.equal(safeSearchQuery('ocean waves').query, 'ocean waves');
  });

  test('rejects an empty query', () => {
    assert.equal(safeSearchQuery('').ok, false);
  });
});
