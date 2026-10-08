import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { loadFont, measureText, _clearFontCache } from './fontMetrics.js';
import { FONT_DIR } from './videoFilters.js';

const font = (name) => path.join(FONT_DIR, name);
const DEJAVU = font('DejaVuSans.ttf');

test('widths match what ffmpeg draws for the operator\'s caption text', () => {
  // ffmpeg 8.0's own text_w for "changing prayed" at 57px, read with
  // drawtext x='print(tw)'. The old 0.6em estimate put every one at 513px.
  assert.equal(measureText(DEJAVU, 'changing prayed', 57), 481);
  assert.equal(measureText(font('PlayfairDisplay-BoldItalic.ttf'), 'changing prayed', 57), 425);
  assert.equal(measureText(font('PermanentMarker.ttf'), 'changing prayed', 57), 444);
  assert.equal(measureText(font('Caveat-Bold.ttf'), 'changing prayed', 57), 319);
  assert.equal(measureText(font('Anton.ttf'), 'changing prayed', 57), 385);
  assert.equal(measureText(font('Drybrush.ttf'), 'changing prayed', 57), 379);
});

test('shaped widths equal ffmpeg 8 text_w where the text has kerning and ligatures', () => {
  // Read the same way at 90px. "fifty AVA you" has an "fi" ligature and
  // kerned capitals; Permanent Marker kerns from a legacy kern table only.
  const cases = {
    'DejaVuSans.ttf': [759, 1072, 572],
    'PlayfairDisplay-BoldItalic.ttf': [670, 967, 507],
    'PermanentMarker.ttf': [701, 1120, 570],
    'Caveat-Bold.ttf': [504, 716, 395],
    'Anton.ttf': [607, 877, 441],
    'Drybrush.ttf': [597, 989, 502],
  };
  for (const [name, widths] of Object.entries(cases)) {
    ['changing prayed', 'To You we lift our voices', 'fifty AVA you'].forEach((text, i) => {
      assert.equal(measureText(font(name), text, 90), widths[i], `${name}: ${text}`);
    });
  }
});

test('a ligature is set as one glyph, as HarfBuzz sets it', () => {
  const caveat = font('Caveat-Bold.ttf');
  assert.ok(measureText(caveat, 'fi', 100) < measureText(caveat, 'f', 100) + measureText(caveat, 'i', 100));
});

test('the pen part-way in counts kerning across that point', () => {
  // Where the "o" starts in "To" is the T's advance PLUS the T-o kerning,
  // which measuring "T" on its own misses.
  const marker = font('PermanentMarker.ttf');
  assert.ok(measureText(marker, 'To', 90, { upTo: 1 }) < measureText(marker, 'T', 90));
  assert.ok(measureText(DEJAVU, 'AV', 100, { upTo: 1 }) < measureText(DEJAVU, 'A', 100));
  assert.ok(measureText(DEJAVU, 'To', 90, { upTo: 1, kerning: 'legacy' }) <= measureText(DEJAVU, 'T', 90, { kerning: 'legacy' }));
});

test('the pen at the start is 0 and at the end is the width', () => {
  for (const kerning of ['shaped', 'legacy', 'none']) {
    assert.equal(measureText(DEJAVU, 'Peace be still', 60, { kerning, upTo: 0 }), 0, kerning);
    assert.equal(measureText(DEJAVU, 'Peace be still', 60, { kerning, upTo: 14 }),
      measureText(DEJAVU, 'Peace be still', 60, { kerning }), kerning);
  }
});

test('a proportional face gives narrow and wide letters different widths', () => {
  assert.ok(measureText(DEJAVU, 'iiii', 60) < measureText(DEJAVU, 'WWWW', 60));
});

test('ffmpeg 5.1 rounds each glyph advance on its own, as it moves its pen', () => {
  const one = measureText(DEJAVU, 'i', 37, { kerning: 'legacy' });
  assert.equal(measureText(DEJAVU, 'iii', 37, { kerning: 'legacy' }), one * 3);
});

test('pair kerning from the kern table is applied', () => {
  const pair = measureText(DEJAVU, 'AV', 100);
  const apart = measureText(DEJAVU, 'A', 100) + measureText(DEJAVU, 'V', 100);
  assert.ok(pair < apart, `AV ${pair}px should be tighter than A+V ${apart}px`);
});

test('empty and missing text measure zero', () => {
  assert.equal(measureText(DEJAVU, '', 50), 0);
  assert.equal(measureText(DEJAVU, null, 50), 0);
});

test('width scales with font size', () => {
  const small = measureText(DEJAVU, 'Peace be still', 40);
  const big = measureText(DEJAVU, 'Peace be still', 80);
  assert.ok(Math.abs(big - small * 2) <= 14, `${small} at 40px vs ${big} at 80px`);
});

test('a font is read once and kept', () => {
  _clearFontCache();
  const first = loadFont(DEJAVU);
  assert.equal(loadFont(DEJAVU), first);
  assert.ok(first.unitsPerEm > 0);
});

test('an unreadable font throws rather than measuring nonsense', () => {
  assert.throws(() => measureText(font('no-such-font.ttf'), 'x', 10));
  assert.throws(() => loadFont(font('DejaVuSans-LICENSE.txt')));
});

test('legacy kerning measures what ffmpeg 5.1 draws, not what it should', () => {
  // 5.1 looks kerning pairs up by character code, so DejaVu's real pairs
  // never apply. A separate simulation of 5.1's drawtext gave 1101px here.
  const text = 'To You we lift our voices';
  assert.equal(measureText(DEJAVU, text, 90), 1072);
  assert.equal(measureText(DEJAVU, text, 90, { kerning: 'legacy' }), 1101);
  assert.equal(measureText(DEJAVU, text, 90, { kerning: 'none' }), 1101);
});
