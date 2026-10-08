import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import {
  buildLineDrawtext,
  fontFileFor,
  highlightLine,
  listKineticAnimations,
  listTypographyPresets,
  resolveTypographyPreset,
  textWidthFor,
} from './videoFilters.js';

// Story Video, "Per line" with "Highlight every word": the operator's render
// (story-video_8, Headline) lit each word several letters away from itself,
// because its position assumed every glyph is 0.6em wide. These pin the word
// to where the font actually draws it, for every caption style.

const W = 720;
const H = 1280;
const SAID = ['changing', 'prayed', 'again', 'You', 'watched', 'other', 'people', 'testify'];
const WORDS = SAID.map((text, i) => ({ text, start: i * 0.5, end: i * 0.5 + 0.5 }));
const LINE = SAID.join(' ');

const drawtexts = (out) => out.split(/,(?=drawtext=)/).map((d) => ({
  text: d.match(/text='([^']*)'/)[1],
  x: d.match(/:x=([^:]+):/)[1],
  y: d.match(/:y=([^:]+):/)[1],
  size: Number(d.match(/fontsize=(\d+)/)[1]),
  color: d.match(/fontcolor=([^:]+)/)[1],
  font: path.basename((d.match(/fontfile='([^']+)'/) || [])[1] || ''),
}));

const render = (preset, extra = {}) => drawtexts(buildLineDrawtext({
  lines: [LINE], w: W, h: H, preset, duration: 4, reveal: true, highlightWords: WORDS, ...extra,
}));

const one = (row, from, to, words) => highlightLine([row], [[from, to]], words)[0];

test('highlightLine matches whole words in spoken order', () => {
  const hits = one('prayed again You', 0.5, 2, WORDS);
  assert.deepEqual(hits.map((h) => [h.text, h.offset]), [['prayed', 0], ['again', 7], ['You', 13]]);
  assert.deepEqual([hits[0].a, hits[0].b], [0.5, 1]);
});

test('highlightLine never lights a word inside a longer one', () => {
  assert.deepEqual(one('come again', 0, 2, [{ text: 'in', start: 0, end: 1 }]), []);
});

test('a word said twice on one row lights each copy in turn', () => {
  const hits = one('holy holy holy', 0, 3, [
    { text: 'holy', start: 0, end: 1 },
    { text: 'holy', start: 1, end: 2 },
    { text: 'Holy', start: 2, end: 3 },
  ]);
  assert.deepEqual(hits.map((h) => h.offset), [0, 5, 10]);
});

test('the row\'s own spelling is drawn, punctuation and all', () => {
  const hits = one('Again, Lord!', 0, 2, [
    { text: 'again', start: 0, end: 1 },
    { text: 'lord', start: 1, end: 2 },
  ]);
  assert.deepEqual(hits.map((h) => h.text), ['Again,', 'Lord!']);
});

test('curly and straight apostrophes are the same word', () => {
  const hits = one('God’s love', 0, 2, [{ text: "God's", start: 0, end: 1 }]);
  assert.deepEqual(hits.map((h) => h.text), ['God’s']);
});

test('words spoken outside the line\'s window are left alone', () => {
  assert.deepEqual(one('prayed again', 2, 3, WORDS), []);
});

test('a word still being said as the next row appears stays on its own row', () => {
  // Rows split the line's time evenly, not by speech. Row 1's "the" runs past
  // the switch; matched row by row it claimed row 2's "the" and skipped
  // "and", which never lit.
  const words = [
    { text: 'Come', start: 0, end: 0.9 },
    { text: 'to', start: 0.9, end: 1.4 },
    { text: 'the', start: 1.9, end: 2.1 },
    { text: 'and', start: 2.2, end: 2.6 },
    { text: 'the', start: 2.6, end: 2.9 },
    { text: 'world', start: 2.9, end: 3.8 },
  ];
  const [row1, row2] = highlightLine(['Come to the', 'and the world'], [[0, 2], [2, 4]], words);
  assert.deepEqual(row1.map((h) => [h.text, h.offset]), [['Come', 0], ['to', 5], ['the', 8]]);
  assert.deepEqual([row1[2].a, row1[2].b], [1.9, 2]);
  assert.deepEqual(row2.map((h) => [h.text, h.offset, h.a]), [['and', 0, 2.2], ['the', 4, 2.6], ['world', 8, 2.9]]);
});

test('a preset without its own face draws in the bundled DejaVu Sans', () => {
  assert.equal(path.basename(fontFileFor(resolveTypographyPreset('cinematic-default'))), 'DejaVuSans.ttf');
  assert.equal(path.basename(fontFileFor(null)), 'DejaVuSans.ttf');
  for (const d of render('cinematic-default')) assert.equal(d.font, 'DejaVuSans.ttf');
});

test('in every caption style each spoken word lights once, where it sits in its row', () => {
  for (const preset of listTypographyPresets()) {
    const style = resolveTypographyPreset(preset);
    const parts = render(preset);
    // A row's x is its anchor; each highlighted word's is that anchor plus an offset.
    const rows = parts.filter((d) => !/\+\d+$/.test(d.x));
    const lit = parts.filter((d) => /\+\d+$/.test(d.x));
    assert.ok(rows.length > 1, `${preset}: expected the line to wrap into rows`);
    assert.equal(lit.length, SAID.length, `${preset}: ${lit.map((d) => d.text).join(' ')}`);
    for (const word of lit) {
      const row = rows.find((r) => word.x.startsWith(`${r.x}+`) && r.text.split(' ').includes(word.text));
      assert.ok(row, `${preset}: "${word.text}" has no row`);
      const offset = (` ${row.text} `).indexOf(` ${word.text} `);
      const prefix = textWidthFor(style, row.text.slice(0, offset), row.size);
      assert.equal(word.x, `${row.x}+${prefix}`, `${preset}: "${word.text}"`);
    }
  }
});

test('a highlighted word shares its row\'s baseline', () => {
  // drawtext puts the top of the tallest glyph at y, so "AGAIN" alone sat
  // higher than "AGAIN YOU". Both are placed by baseline instead.
  for (const preset of listTypographyPresets()) {
    for (const d of render(preset)) assert.match(d.y, /^\d+-ascent$/, `${preset}: "${d.text}" y=${d.y}`);
    const ys = new Set(render(preset).filter((d) => d.text === 'again' || d.text.includes('again')).map((d) => d.y));
    assert.equal(ys.size, 1, `${preset}: row and word disagree on y: ${[...ys].join(' / ')}`);
  }
});

test('without a highlight the row keeps ffmpeg\'s own centring and plain y', () => {
  const [row] = drawtexts(buildLineDrawtext({ lines: ['prayed again'], w: W, h: H, preset: 'headline', duration: 2, reveal: true }));
  assert.match(row.x, /text_w/);
  assert.match(row.y, /^\d+$/);
});

test('Headline lights words in a colour that stands apart from its text', () => {
  const parts = render('headline');
  const rowColor = parts[0].color;
  const word = parts.find((d) => d.text === 'prayed');
  assert.equal(word.color, '0xFFB020');
  assert.notEqual(word.color, rowColor);
});

test('Marker no longer lights words in its own text colour', () => {
  const parts = render('marker');
  const word = parts.find((d) => d.text === 'prayed');
  assert.equal(word.color, '0xB3261E');
  assert.notEqual(word.color, parts[0].color);
});

test('the Brush style draws in Drybrush and is offered in the catalogue', () => {
  const style = resolveTypographyPreset('brush');
  assert.equal(style.fontFamily, 'brush');
  assert.equal(path.basename(fontFileFor(style)), 'Drybrush.ttf');
  const entry = listKineticAnimations().find((a) => a.id === 'brush');
  assert.ok(entry, 'brush missing from the caption catalogue');
  assert.equal(entry.renderable, true);
  assert.equal(entry.presetId, 'brush');
  for (const d of render('brush')) assert.equal(d.font, 'Drybrush.ttf');
});

test('highlighting still works when the rows sit to the left', () => {
  const parts = render('headline', { layout: 'bottom-left' });
  const word = parts.find((d) => d.text === 'prayed');
  assert.match(word.x, /^w\*0\.08\+\d+$/);
});

test('rows are measured the way this machine\'s ffmpeg kerns', () => {
  // Prod's 5.1 kerns differently from a 6.1+ dev box; the row width in the
  // filter must follow the one that will draw it.
  const before = process.env.DRAWTEXT_KERNING;
  const rowWidth = () => {
    const [row] = drawtexts(buildLineDrawtext({
      lines: ['To You we'], w: W, h: H, preset: 'cinematic-default', duration: 2, reveal: true,
      highlightWords: [{ text: 'we', start: 0, end: 1 }],
    }));
    return row.x;
  };
  try {
    process.env.DRAWTEXT_KERNING = 'shaped';
    const shaped = rowWidth();
    process.env.DRAWTEXT_KERNING = 'legacy';
    assert.notEqual(rowWidth(), shaped);
  } finally {
    if (before === undefined) delete process.env.DRAWTEXT_KERNING;
    else process.env.DRAWTEXT_KERNING = before;
  }
});

test('only one word is lit at the instant one word hands over to the next', () => {
  // "the" ends at 12.48 and "head" starts at 12.48. With between(), which
  // includes both ends, a frame landing exactly there lit both.
  const out = buildLineDrawtext({
    lines: ['the head of'], w: W, h: H, preset: 'headline', duration: 2, reveal: true,
    highlightWords: [{ text: 'the', start: 0.3, end: 0.48 }, { text: 'head', start: 0.48, end: 0.58 }],
  });
  const windows = [...out.matchAll(/enable='gte\(t,([\d.]+)\)\*lt\(t,([\d.]+)\)'/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.deepEqual(windows, [[0.3, 0.48], [0.48, 0.58]]);
  const litAt = (t) => windows.filter(([a, b]) => t >= a && t < b).length;
  assert.equal(litAt(0.48), 1);
});
