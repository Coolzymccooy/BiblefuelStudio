import test from 'node:test';
import assert from 'node:assert/strict';
import {
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
