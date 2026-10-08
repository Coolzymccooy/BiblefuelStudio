import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { loadFont, measureText, _clearFontCache } from './fontMetrics.js';
import { FONT_DIR } from './videoFilters.js';

const font = (name) => path.join(FONT_DIR, name);
const DEJAVU = font('DejaVuSans.ttf');

test('widths match what ffmpeg draws for the operator\'s caption text', () => {
  // Measured against real drawtext renders of "changing prayed" at 57px.
  // The old 0.6em estimate put every one of these at 513px.
  assert.equal(measureText(DEJAVU, 'changing prayed', 57), 479);
  assert.equal(measureText(font('PlayfairDisplay-BoldItalic.ttf'), 'changing prayed', 57), 426);
  assert.equal(measureText(font('PermanentMarker.ttf'), 'changing prayed', 57), 442);
  assert.equal(measureText(font('Caveat-Bold.ttf'), 'changing prayed', 57), 321);
  assert.equal(measureText(font('Anton.ttf'), 'changing prayed', 57), 385);
  assert.equal(measureText(font('Drybrush.ttf'), 'changing prayed', 57), 378);
});

test('a proportional face gives narrow and wide letters different widths', () => {
  assert.ok(measureText(DEJAVU, 'iiii', 60) < measureText(DEJAVU, 'WWWW', 60));
});

test('each glyph advance is rounded on its own, as drawtext moves its pen', () => {
  const one = measureText(DEJAVU, 'i', 37);
  assert.equal(measureText(DEJAVU, 'iii', 37), one * 3);
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
