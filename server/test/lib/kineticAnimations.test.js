import { test } from "node:test";
import assert from "node:assert/strict";

import {
  listKineticAnimations,
  resolveKineticAnimation,
  resolveTypographyPreset,
  buildWordDrawtext,
} from "../../src/lib/videoFilters.js";

/**
 * The kinetic animation catalog is the biblefuel port of lumina-presenter's
 * design-animations. Browser-only effects (particles, WebGL, 3D extrude,
 * metal/glass fill, audio-reactive) don't render in ffmpeg drawtext, so each
 * catalog entry declares `renderable` + `unsupported[]`. Non-renderable entries
 * still map to a real preset so the renderer never crashes.
 */

// ─── Catalog (Phase A) ───────────────────────────────────────────────────

test("listKineticAnimations exposes the full lumina catalog", () => {
  const ids = listKineticAnimations().map((a) => a.id);
  for (const id of [
    "cinematic-worship",
    "cinematic-reactive",
    "scripture-reveal",
    "word-boxes",
    "hero-bold",
    "music-video",
  ]) {
    assert.ok(ids.includes(id), `catalog missing ${id}`);
  }
});

test("each catalog entry has label, description, presetId, renderable flag", () => {
  for (const a of listKineticAnimations()) {
    assert.equal(typeof a.label, "string");
    assert.equal(typeof a.description, "string");
    assert.equal(typeof a.presetId, "string");
    assert.equal(typeof a.renderable, "boolean");
    assert.ok(Array.isArray(a.unsupported));
    // presetId must resolve to a concrete style (renderer never crashes).
    assert.equal(typeof resolveTypographyPreset(a.presetId).baseSizeMult, "number");
  }
});

test("cinematic-reactive is renderable but flags audio-reactive as unsupported", () => {
  const a = resolveKineticAnimation("cinematic-reactive");
  assert.ok(a);
  assert.equal(a.renderable, true);
  assert.ok(a.unsupported.includes("audio-reactive"));
});

test("a browser-only animation (webgl-bloom) is renderable:false with a fallback preset", () => {
  const a = resolveKineticAnimation("webgl-bloom");
  assert.ok(a);
  assert.equal(a.renderable, false);
  assert.ok(a.unsupported.length > 0);
  assert.equal(typeof resolveTypographyPreset(a.presetId).baseSizeMult, "number");
});

test("renderable animation presets carry motion fields", () => {
  const worship = resolveTypographyPreset("cinematic-worship");
  assert.equal(worship.wordReveal, "fade");
  assert.equal(worship.lineEnter, "rise-fade");
  assert.equal(typeof worship.wordRevealMs, "number");
});

// ─── Motion in buildWordDrawtext (Phase B) ────────────────────────────────

test("fade preset emits a per-word alpha fade-in keyed to the word start", () => {
  const words = [{ text: "Lord", start: 0.5, end: 1.2 }];
  const filter = buildWordDrawtext({ words, w: 1080, h: 1920, preset: "cinematic-worship" });
  assert.ok(filter);
  assert.ok(filter.includes("alpha='clip("), "expected an alpha fade expression");
  assert.ok(filter.includes("t-0.500"), "fade should be keyed to the word start time");
});

test("rise-fade word reveal animates y (rise) in addition to alpha", () => {
  const words = [{ text: "Glory", start: 0, end: 0.8 }];
  const filter = buildWordDrawtext({ words, w: 1080, h: 1920, preset: "hero-bold" });
  assert.ok(filter);
  assert.ok(filter.includes("alpha='clip("), "rise-fade should also fade");
  assert.ok(filter.includes("1-clip("), "rise-fade should animate y with an easing term");
});

test("no-motion preset (cinematic-default) keeps the hard-cut behavior (no alpha)", () => {
  const words = [{ text: "Be", start: 0, end: 0.4 }];
  const filter = buildWordDrawtext({ words, w: 1080, h: 1920 });
  assert.ok(filter);
  assert.ok(!filter.includes("alpha='clip("), "default preset must not animate alpha");
});

test("uppercase preset renders the word in uppercase", () => {
  const words = [{ text: "Faith", start: 0, end: 0.6 }];
  const filter = buildWordDrawtext({ words, w: 1080, h: 1920, preset: "hero-bold" });
  assert.ok(filter.includes("FAITH"), "hero-bold should uppercase the word");
  assert.ok(!filter.includes("text='Faith'"), "original casing should not appear");
});

test("fade duration never exceeds the word's visible window", () => {
  // A very short word window (0.1s) with a long preset reveal must clamp so the
  // alpha divisor stays <= the window (otherwise the word never reaches full).
  const words = [{ text: "Amen", start: 2.0, end: 2.1 }];
  const filter = buildWordDrawtext({ words, w: 1080, h: 1920, preset: "scripture-reveal" });
  assert.ok(filter.includes("alpha='clip("));
  // divisor appears as /<seconds> — extract it and assert <= window (0.1).
  const m = filter.match(/\(t-2\.000\)\/([0-9.]+)/);
  assert.ok(m, "expected a fade divisor for the word");
  assert.ok(Number(m[1]) <= 0.1 + 1e-9, `fade divisor ${m[1]} should clamp to the 0.1s window`);
});
