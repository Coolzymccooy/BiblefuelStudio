import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fitLineFontSize,
  resolveTypographyPreset,
  listTypographyPresets,
  listKineticAnimations,
  buildWordDrawtext,
  buildLineDrawtext,
} from './videoFilters.js';

// The operator pointed at a TikTok ad for a competitor ("Captions: AI Edits
// Your Video") and asked for exactly those caption looks. Three distinct
// styles appear across the reference video:
//
//   marker      one word on a rough highlighter block, script face
//   soft-glow   pale bold word with a dark outline, no block
//   headline    very large pale word, top of frame
//
// Each must work BOTH per-word AND per-line - the operator was explicit that
// line mode is "the beauty" of it, not an afterthought.

const W = 1080;
const H = 1920;

const WORDS = [
  { text: 'God', start: 0.0, end: 0.4, tier: 'hero' },
  { text: 'is', start: 0.4, end: 0.7, tier: 'normal' },
  { text: 'close', start: 0.7, end: 1.2, tier: 'key' },
];
const LINES = [
  'God is close to the brokenhearted',
  'and saves those crushed in spirit',
];

const NEW_PRESETS = ['marker', 'soft-glow', 'headline'];

test('every new preset resolves rather than silently falling back', () => {
  for (const id of NEW_PRESETS) {
    const p = resolveTypographyPreset(id);
    assert.ok(p, id);
    // A miss returns the default; check it is genuinely distinct from it.
    const dflt = resolveTypographyPreset('cinematic-default');
    assert.notDeepEqual(p, dflt, `${id} resolved to the default preset`);
  }
});

test('the new presets are offered in the picker', () => {
  const ids = listTypographyPresets().map((p) => p.id ?? p);
  for (const id of NEW_PRESETS) assert.ok(ids.includes(id), `${id} missing from the list`);
});

test('marker renders a filled box behind each word', () => {
  // The block IS the look. Without box=1 it is just yellow text.
  const out = buildWordDrawtext({ words: WORDS, w: W, h: H, preset: 'marker' });
  assert.match(out, /box=1/);
  assert.match(out, /boxcolor=/);
});

test('marker uses a warm highlighter colour, not a neutral panel', () => {
  const out = buildWordDrawtext({ words: WORDS, w: W, h: H, preset: 'marker' });
  // The reference block is saturated yellow; a grey/black panel is the
  // existing word-boxes look and would not read as a marker.
  assert.match(out.toLowerCase(), /boxcolor=0x(f|e|d)[0-9a-f]{5}/);
});

test('marker text is dark, so it reads on a bright block', () => {
  const out = buildWordDrawtext({ words: WORDS, w: W, h: H, preset: 'marker' });
  assert.match(out, /fontcolor=(black|0x[0-2][0-9a-f]{5})/i);
});

test('soft-glow has NO box - the outline is the whole style', () => {
  const out = buildWordDrawtext({ words: WORDS, w: W, h: H, preset: 'soft-glow' });
  assert.doesNotMatch(out, /box=1/);
  assert.match(out, /borderw=/);
});

test('headline is the largest of the three new presets', () => {
  // Originally this demanded >1.3x the default. Rendered frames overruled it:
  // at 0.085 the single word "everything" already spans the full 1080px frame,
  // so a bigger multiplier would clip ordinary words. What actually matters is
  // that headline out-sizes its two siblings, not that it beats a fixed ratio.
  const big = resolveTypographyPreset('headline');
  const dflt = resolveTypographyPreset('cinematic-default');
  assert.ok(big.baseSizeMult > dflt.baseSizeMult, 'headline should exceed the default');
  for (const id of ['marker', 'soft-glow']) {
    assert.ok(big.baseSizeMult > resolveTypographyPreset(id).baseSizeMult,
      `headline ${big.baseSizeMult} should exceed ${id}`);
  }
});

test('all three work in LINE mode, not only per-word', () => {
  // The operator: "make it available also as lines not just one word, that is
  // the beauty". A preset that only renders per-word is half-built.
  for (const id of NEW_PRESETS) {
    const out = buildLineDrawtext({ lines: LINES, w: W, h: H, preset: id });
    assert.ok(out && out.length > 0, `${id} produced no line filter`);
    // Assert the actual TEXT, not just that a drawtext exists. The weaker
    // check passed while every line rendered as "[object Object]".
    assert.match(out, /God is close to the brokenhearted/);
    assert.doesNotMatch(out, /\[object Object\]/);
  }
});

test('marker keeps its block in line mode too', () => {
  const out = buildLineDrawtext({ lines: LINES, w: W, h: H, preset: 'marker' });
  assert.match(out, /box=1/);
});

test('each word is timed, so only one shows at a time', () => {
  const out = buildWordDrawtext({ words: WORDS, w: W, h: H, preset: 'marker' });
  // Every word needs an enable window or they all stack on screen at once -
  // the exact bug the operator reported on their scheduled posts.
  const enables = out.match(/enable=/g) || [];
  assert.ok(enables.length >= WORDS.length, `${enables.length} enable windows for ${WORDS.length} words`);
});

test('text is escaped so an apostrophe cannot break the filtergraph', () => {
  const risky = [{ text: "God's", start: 0, end: 0.5, tier: 'normal' }];
  const out = buildWordDrawtext({ words: risky, w: W, h: H, preset: 'marker' });
  // A raw apostrophe terminates the drawtext argument and ffmpeg rejects the
  // whole graph - the same class of failure as the [0:a] filtergraph bug.
  assert.doesNotMatch(out, /text='God's'/);
});

test('the existing presets are untouched', () => {
  // This work ADDS options; it must not restyle anyone's existing renders.
  const wb = resolveTypographyPreset('word-boxes');
  assert.equal(wb.uppercase, true);
  assert.equal(wb.wordBox, true);
});

// ---------------------------------------------------------------------------
// Line-mode fitting.
//
// A fixed `lineSizeMult` cannot fit arbitrary text: font size is multiplied by
// the frame HEIGHT while the text runs across the frame WIDTH, so the longest
// line decides whether anything clips. Rendered proof: at lineSizeMult 0.034
// the headline preset drew "d is close to the brokenheart" - both ends sheared
// off the 1080px frame - while soft-glow at 0.028 touched both edges with zero
// margin. Both looked fine as filter strings; only the pixels showed it.
//
// So the size must be derived from the longest line, not asserted per preset.

const LONG_LINE = 'And He shall wipe away every tear from their eyes forevermore';

function fontSizeOf(out) {
  return Number((out.match(/fontsize=(\d+)/) || [])[1]);
}

test('a long line is shrunk to fit the frame width', () => {
  for (const id of NEW_PRESETS) {
    const out = buildLineDrawtext({ lines: [LONG_LINE], w: W, h: H, preset: id });
    const size = fontSizeOf(out);
    // ffmpeg's default face is monospace; advance is ~0.6em per glyph. Require
    // the drawn width to leave a real margin rather than merely touch the edge.
    const drawn = LONG_LINE.length * size * 0.6;
    assert.ok(drawn <= W * 0.92,
      `${id}: ${LONG_LINE.length} chars at ${size}px draws ~${Math.round(drawn)}px into a ${W}px frame`);
  }
});

test('a short line is NOT shrunk - fitting only ever caps', () => {
  // Guard against the fix regressing every preset to a timid uniform size.
  for (const id of NEW_PRESETS) {
    const short = fontSizeOf(buildLineDrawtext({ lines: ['Peace'], w: W, h: H, preset: id }));
    const long = fontSizeOf(buildLineDrawtext({ lines: [LONG_LINE], w: W, h: H, preset: id }));
    assert.ok(short >= long, `${id}: short line ${short}px should not be smaller than long ${long}px`);
  }
});

test('the longest line governs the size for the whole block', () => {
  // Mixed lengths must share one size, or the block looks ragged.
  const out = buildLineDrawtext({ lines: ['Peace', LONG_LINE], w: W, h: H, preset: 'headline' });
  const sizes = [...out.matchAll(/fontsize=(\d+)/g)].map((m) => Number(m[1]));
  assert.equal(new Set(sizes).size, 1, `mixed sizes in one block: ${sizes.join(', ')}`);
});

test('fitting applies to the pre-existing presets too', () => {
  // The overflow bug was never marker-specific - it is in the shared sizer.
  const out = buildLineDrawtext({ lines: [LONG_LINE], w: W, h: H, preset: 'cinematic-default' });
  const drawn = LONG_LINE.length * fontSizeOf(out) * 0.6;
  assert.ok(drawn <= W * 0.92, `default preset draws ~${Math.round(drawn)}px into ${W}px`);
});

// ---------------------------------------------------------------------------
// Reachability. A preset that renders beautifully but never appears in the
// picker is not built. The client's AnimationPicker populates itself from
// GET /api/tts/animations, which serves listKineticAnimations() - so being in
// TYPOGRAPHY_PRESETS alone is NOT enough to make a style selectable.

test('each new preset is offered by the animations endpoint the picker reads', () => {
  const catalog = listKineticAnimations();
  for (const id of NEW_PRESETS) {
    const entry = catalog.find((a) => a.id === id);
    assert.ok(entry, `${id} is absent from listKineticAnimations() - unreachable in the UI`);
    assert.ok(entry.label, `${id} has no label to show in the picker`);
    // renderable=false would badge it preview-only, which is exactly the
    // "static preview caption" complaint these styles are meant to answer.
    assert.equal(entry.renderable, true, `${id} is flagged preview-only`);
  }
});

// ---------------------------------------------------------------------------
// Line PACING.
//
// The operator selected Headline with Azure TTS and got the entire script
// stacked on screen at once, lines running off the bottom of the frame -
// indistinguishable from the "static preview mode caption" complaint that
// started this work. Cause: buildLineDrawtext emitted no `enable=` window at
// all, so every line drew for the whole video. buildWordDrawtext has always
// timed its words; line mode never did.
//
// Line mode is only usable if lines appear in sequence, like the reference.

const SCRIPT = [
  'When life feels chaotic, remember this:',
  'Jesus is your anchor in every storm.',
  'His presence brings calm to your heart.',
  'Save this for when you need a reminder.',
];

test('each line gets its own enable window - they do NOT all draw at once', () => {
  const out = buildLineDrawtext({ lines: SCRIPT, w: W, h: H, preset: 'headline', duration: 12 });
  const enables = out.match(/enable=/g) || [];
  assert.equal(enables.length, SCRIPT.length,
    `${enables.length} enable windows for ${SCRIPT.length} lines - unpaced lines stack on screen`);
});

test('the windows are sequential and cover the whole video', () => {
  const duration = 12;
  const out = buildLineDrawtext({ lines: SCRIPT, w: W, h: H, preset: 'headline', duration });
  const spans = [...out.matchAll(/between\(t,([\d.]+),([\d.]+)\)/g)]
    .map((m) => [Number(m[1]), Number(m[2])]);
  assert.equal(spans.length, SCRIPT.length);
  assert.equal(spans[0][0], 0, 'first line should start at t=0');
  for (let i = 1; i < spans.length; i++) {
    assert.ok(spans[i][0] >= spans[i - 1][1] - 0.001,
      `line ${i} starts at ${spans[i][0]} before line ${i - 1} ends at ${spans[i - 1][1]}`);
  }
  assert.ok(Math.abs(spans[spans.length - 1][1] - duration) < 0.05,
    `last line ends at ${spans[spans.length - 1][1]}, not ${duration}`);
});

test('a paced line sits at ONE y position, not stacked down the frame', () => {
  // Once lines are sequential they should share a position - stacking them is
  // what pushed the operator's text off the bottom of the frame.
  const out = buildLineDrawtext({ lines: SCRIPT, w: W, h: H, preset: 'headline', duration: 12 });
  const ys = [...out.matchAll(/:y=(\d+)/g)].map((m) => Number(m[1]));
  assert.equal(new Set(ys).size, 1, `paced lines drew at ${new Set(ys).size} different y values`);
});

test('without a duration, behaviour is unchanged (no false timing)', () => {
  // Callers that never pass a duration must not get invented windows.
  const out = buildLineDrawtext({ lines: SCRIPT, w: W, h: H, preset: 'headline' });
  assert.doesNotMatch(out, /enable=/);
});

// ---------------------------------------------------------------------------
// Caption MODE carried by the preset.
//
// Operator's decision: the three new styles should render PACED LINE BLOCKS
// (matching the reference video), while every pre-existing preset keeps
// word-by-word. Kinetic captions previously forced word mode for every style,
// so picking Marker/Soft Glow/Headline changed only the look - all three still
// rendered one word at a time, which is not what those styles are.
//
// Per-word must remain available: this ADDS a mode, it does not replace one.

test('the three new styles declare line mode', () => {
  for (const id of NEW_PRESETS) {
    assert.equal(resolveTypographyPreset(id).captionMode, 'lines',
      `${id} should render paced lines, not word-by-word`);
  }
});

test('existing presets keep word mode - this adds a mode, it replaces none', () => {
  for (const id of ['cinematic-default', 'word-boxes', 'hero-bold']) {
    const mode = resolveTypographyPreset(id).captionMode;
    assert.notEqual(mode, 'lines', `${id} must stay word-by-word`);
  }
});

// --- paced line BLOCKS -----------------------------------------------------
// One line at a time is too slow to read and wastes the frame; the reference
// shows a short phrase block. Blocks also let type be far larger: a 49-char
// line caps at 32px on a 1080 frame, while a 16-char line reaches ~99px.

const BLOCK_SCRIPT = [
  "Life's storms can feel overwhelming.",
  'In the midst of the storm, Jesus offers us peace.',
  'Trust that His presence calms the chaos around you.',
];

test('a long line is wrapped into a block of short lines', () => {
  const out = buildLineDrawtext({
    lines: BLOCK_SCRIPT, w: W, h: H, preset: 'headline', duration: 15, block: true,
  });
  // Each drawn line must be short enough to render large.
  const texts = [...out.matchAll(/text='([^']*)'/g)].map((m) => m[1]);
  for (const t of texts) {
    assert.ok(t.length <= 24, `"${t}" is ${t.length} chars - too wide to render large`);
  }
});

test('block mode renders type far larger than one long line', () => {
  const flat = buildLineDrawtext({ lines: BLOCK_SCRIPT, w: W, h: H, preset: 'headline', duration: 15 });
  const block = buildLineDrawtext({ lines: BLOCK_SCRIPT, w: W, h: H, preset: 'headline', duration: 15, block: true });
  const sizeOf = (s) => Number((s.match(/fontsize=(\d+)/) || [])[1]);
  assert.ok(sizeOf(block) > sizeOf(flat) * 1.8,
    `block ${sizeOf(block)}px should dwarf flat ${sizeOf(flat)}px - the whole point of wrapping`);
});

test('lines of one block share a window and stack; blocks are sequential', () => {
  const out = buildLineDrawtext({
    lines: BLOCK_SCRIPT, w: W, h: H, preset: 'headline', duration: 15, block: true,
  });
  const spans = [...out.matchAll(/between\(t,([\d.]+),([\d.]+)\)/g)].map((m) => m[1] + '-' + m[2]);
  const groups = [...new Set(spans)];
  assert.equal(groups.length, BLOCK_SCRIPT.length, 'one window per block');
  // Within a block the lines stack, so several drawtexts share one window.
  assert.ok(spans.length > groups.length, 'block lines should share their window');
});

test('a block sits centred as a group, not drifting down the frame', () => {
  const out = buildLineDrawtext({
    lines: ['Trust that His presence calms the chaos around you.'],
    w: W, h: H, preset: 'headline', duration: 6, block: true,
  });
  const ys = [...out.matchAll(/:y=(\d+)/g)].map((m) => Number(m[1]));
  // Wrapped lines stack, so the block must straddle the centre band rather
  // than starting at it and running off the bottom.
  assert.ok(Math.min(...ys) < H * 0.5 && Math.max(...ys) < H * 0.8,
    `block spans y ${Math.min(...ys)}..${Math.max(...ys)} on a ${H} frame`);
});

// ---------------------------------------------------------------------------
// TRUE line-by-line ("reveal") mode.
//
// Block mode shows a wrapped phrase as a stack - the operator correctly
// pointed out that is "almost 4 lines", not line-by-line. Reveal mode shows
// ONE wrapped row at a time.
//
// The reason rows are used rather than whole sentences: a 51-character
// sentence caps at 31px on a 1080 frame (the width budget binds), while a
// wrapped row holds 99px. Line-by-line on raw sentences would be unreadable.

test('reveal mode shows exactly one row at a time', () => {
  const out = buildLineDrawtext({
    lines: ['Trust that His presence calms the chaos around you.'],
    w: W, h: H, preset: 'headline', duration: 8, reveal: true,
  });
  const spans = [...out.matchAll(/between\(t,([\d.]+),([\d.]+)\)/g)];
  const texts = [...out.matchAll(/text='([^']*)'/g)].map((m) => m[1]);
  assert.equal(spans.length, texts.length, 'every row needs its own window');
  // Each window must be unique - sharing one is block mode, not reveal.
  assert.equal(new Set(spans.map((s) => s[1] + '-' + s[2])).size, texts.length);
  assert.ok(texts.length >= 3, `expected the sentence split into rows, got ${texts.length}`);
});

test('reveal keeps type large - the point of wrapping first', () => {
  const out = buildLineDrawtext({
    lines: ['Trust that His presence calms the chaos around you.'],
    w: W, h: H, preset: 'headline', duration: 8, reveal: true,
  });
  const size = Number((out.match(/fontsize=(\d+)/) || [])[1]);
  assert.ok(size >= 80, `${size}px is too small - revealing raw sentences caps near 31px`);
});

test('reveal rows sit at one position and cover the duration', () => {
  const duration = 8;
  const out = buildLineDrawtext({
    lines: ['Trust that His presence calms the chaos around you.'],
    w: W, h: H, preset: 'headline', duration, reveal: true,
  });
  assert.equal(new Set([...out.matchAll(/:y=(\d+)/g)].map((m) => m[1])).size, 1,
    'revealed rows should not drift down the frame');
  const spans = [...out.matchAll(/between\(t,([\d.]+),([\d.]+)\)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.equal(spans[0][0], 0);
  assert.ok(Math.abs(spans[spans.length - 1][1] - duration) < 0.05);
});

test('block mode still stacks - reveal ADDS a mode, replaces none', () => {
  const out = buildLineDrawtext({
    lines: ['Trust that His presence calms the chaos around you.'],
    w: W, h: H, preset: 'headline', duration: 8, block: true,
  });
  assert.equal(new Set([...out.matchAll(/between\(t,([\d.]+),([\d.]+)\)/g)].map((m) => m[1])).size, 1,
    'block mode shows its rows together');
});

// ---------------------------------------------------------------------------
// Word highlight WITHIN a line ("karaoke" over paced lines).
//
// Operator: "then each word can highlight even on the line". This is the third
// mode, not a replacement - the full line stays on screen for context while
// the currently-spoken word is emphasised, rather than words appearing alone.
//
// It needs word timings, so it only applies when the caller has them.

const HL_WORDS = [
  { text: 'Trust', start: 0.0, end: 0.6 },
  { text: 'that', start: 0.6, end: 1.0 },
  { text: 'His', start: 1.0, end: 1.6 },
];

test('highlight mode keeps the whole line on screen', () => {
  const out = buildLineDrawtext({
    lines: ['Trust that His'], w: W, h: H, preset: 'marker',
    duration: 2, reveal: true, highlightWords: HL_WORDS,
  });
  // The base line must be drawn, not just the individual words.
  assert.match(out, /text='Trust that His'/);
});

test('highlight mode emphasises one word at a time', () => {
  const out = buildLineDrawtext({
    lines: ['Trust that His'], w: W, h: H, preset: 'marker',
    duration: 2, reveal: true, highlightWords: HL_WORDS,
  });
  // Each word needs its own timed overlay on top of the line.
  for (const wd of HL_WORDS) {
    assert.ok(out.includes(`text='${wd.text}'`), `no highlight overlay for "${wd.text}"`);
  }
  const windows = [...out.matchAll(/between\(t,([\d.]+),([\d.]+)\)/g)];
  assert.ok(windows.length > HL_WORDS.length,
    'expected per-word windows plus the line window');
});

test('without word timings, highlight mode is inert (no invented emphasis)', () => {
  const plain = buildLineDrawtext({
    lines: ['Trust that His'], w: W, h: H, preset: 'marker', duration: 2, reveal: true,
  });
  const texts = [...plain.matchAll(/text='([^']*)'/g)].map((m) => m[1]);
  assert.deepEqual(texts, ['Trust that His'], 'no word overlays without timings');
});

// ---------------------------------------------------------------------------
// Typography: real fonts.
//
// Every caption rendered in ffmpeg's default monospace, which is why our
// output read as "generated" next to the reference: that ad uses a script
// face, a marker face and a serif italic. Motion was never the gap - the
// typeface was.
//
// Fonts are bundled under server/assets/fonts (all OFL/Apache, redistributable
// - system fonts are NOT, and would be absent on the Linux server anyway).

import fs from 'node:fs';
import path from 'node:path';
import { fontFileFor, FONT_DIR } from './videoFilters.js';

test('every preset font resolves to a file that exists', () => {
  for (const id of [...NEW_PRESETS, 'cinematic-default']) {
    const file = fontFileFor(resolveTypographyPreset(id));
    if (!file) continue; // monospace default is allowed
    assert.ok(fs.existsSync(file), `${id} points at a missing font: ${file}`);
  }
});

test('bundled fonts are real TTFs, not error pages', () => {
  // A 404 from a font CDN saves as an HTML page with a .ttf name and fails
  // silently at render time - drawtext just falls back to monospace.
  for (const f of fs.readdirSync(FONT_DIR).filter((n) => n.endsWith('.ttf'))) {
    const fd = fs.openSync(path.join(FONT_DIR, f), 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    const sig = buf.toString('hex');
    assert.ok(sig === '00010000' || sig === '74727565' || sig === '4f54544f',
      `${f} is not a TTF (signature ${sig})`);
  }
});

test('the marker style uses a marker face, not monospace', () => {
  const out = buildWordDrawtext({ words: WORDS, w: W, h: H, preset: 'marker' });
  assert.match(out, /fontfile=/);
});

test('a font path is escaped for ffmpeg (Windows drive colon)', () => {
  // An unescaped "C:" terminates the drawtext option and kills the graph.
  const out = buildWordDrawtext({ words: WORDS, w: W, h: H, preset: 'marker' });
  const m = out.match(/fontfile='([^']*)'/);
  if (m && /^[A-Za-z]:/.test(m[1].split(String.fromCharCode(92)).join(''))) {
    assert.match(m[1], new RegExp(String.fromCharCode(92)+':'), `drive colon not escaped in ${m[1]}`);
  }
});

test('captions leave breathing room - not edge to edge', () => {
  // Operator: "we should make the line smarter, it currently feels too big".
  // 88% of frame width filled the frame; the reference sits well inside it.
  const rows = ['Trust that His', 'presence calms'];
  const size = fitLineFontSize(rows, W, 400);
  const widest = Math.max(...rows.map((r) => r.length));
  const drawn = widest * size * 0.6;
  assert.ok(drawn <= W * 0.75, `draws ~${Math.round(drawn)}px of ${W} - too wide`);
});
