import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import {
  buildLineDrawtext,
  fontFileFor,
  highlightsInRow,
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

test('highlightsInRow matches whole words in spoken order', () => {
  const hits = highlightsInRow('prayed again You', 0, 4, WORDS);
  assert.deepEqual(hits.map((h) => [h.text, h.offset]), [['prayed', 0], ['again', 7], ['You', 13]]);
  assert.deepEqual([hits[0].a, hits[0].b], [0.5, 1]);
});

test('highlightsInRow never lights a word inside a longer one', () => {
  const hits = highlightsInRow('come again', 0, 2, [{ text: 'in', start: 0, end: 1 }]);
  assert.deepEqual(hits, []);
});

test('a word said twice on one row lights each copy in turn', () => {
  const hits = highlightsInRow('holy holy holy', 0, 3, [
    { text: 'holy', start: 0, end: 1 },
    { text: 'holy', start: 1, end: 2 },
    { text: 'Holy', start: 2, end: 3 },
  ]);
  assert.deepEqual(hits.map((h) => h.offset), [0, 5, 10]);
});

test('the row\'s own spelling is drawn, punctuation and all', () => {
  const hits = highlightsInRow('Again, Lord!', 0, 2, [
    { text: 'again', start: 0, end: 1 },
    { text: 'lord', start: 1, end: 2 },
  ]);
  assert.deepEqual(hits.map((h) => h.text), ['Again,', 'Lord!']);
});

test('words spoken outside the row\'s window are left alone', () => {
  assert.deepEqual(highlightsInRow('prayed again', 2, 3, WORDS), []);
});

test('a preset without its own face draws in the bundled DejaVu Sans', () => {
  assert.equal(path.basename(fontFileFor(resolveTypographyPreset('cinematic-default'))), 'DejaVuSans.ttf');
  assert.equal(path.basename(fontFileFor(null)), 'DejaVuSans.ttf');
  for (const d of render('cinematic-default')) assert.equal(d.font, 'DejaVuSans.ttf');
});

test('in every caption style the highlighted word starts where it sits in its row', () => {
  for (const preset of listTypographyPresets()) {
    const style = resolveTypographyPreset(preset);
    const parts = render(preset);
    // A row's x is its anchor; each highlighted word's is that anchor plus an offset.
    const rows = parts.filter((d) => !/\+\d+$/.test(d.x));
    assert.ok(rows.length > 1, `${preset}: expected the line to wrap into rows`);
    let checked = 0;
    for (const row of rows) {
      const rowX = row.x;
      for (const hit of highlightsInRow(row.text, 0, 4, WORDS)) {
        const word = parts.find((d) => d !== row && d.text === hit.text && d.x.startsWith(`${rowX}+`));
        assert.ok(word, `${preset}: no highlight for "${hit.text}" on row "${row.text}"`);
        const prefix = textWidthFor(style, row.text.slice(0, hit.offset), row.size);
        assert.equal(word.x, `${rowX}+${prefix}`, `${preset}: "${hit.text}"`);
        checked += 1;
      }
    }
    assert.ok(checked > 0, `${preset}: nothing was highlighted`);
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
  const word = parts.find((d) => d.text.toUpperCase() === 'PRAYED' || d.text === 'prayed');
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
