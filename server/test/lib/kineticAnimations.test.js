import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  listKineticAnimations,
  resolveKineticAnimation,
  resolveTypographyPreset,
  listTypographyPresets,
  buildWordDrawtext,
  listLayouts,
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

// ─── Hero size tier (3-tier emphasis) ─────────────────────────────────────
// Words carry level: "normal" | "key" | "hero". Hero words render at a third,
// larger size (heroSizeMult) in heroColor. Presets without hero fields fall
// back to emphasisSizeMult * 1.25 and emphasisColor, so existing presets keep
// identical key/normal output (no regression).

test("hero word renders larger than a key word in the same preset", () => {
  const words = [
    { text: "mercy", start: 0, end: 1, level: "key", emphasize: true },
    { text: "Lord", start: 1, end: 2, level: "hero", emphasize: true },
  ];
  const filter = buildWordDrawtext({ words, w: 1080, h: 1920 }); // cinematic-default
  // cinematic-default has no hero fields → hero = round(0.085*1.25*1920) = 204,
  // key = round(0.085*1920) = 163.
  assert.ok(filter.includes("fontsize=204"), "hero word should use the hero size");
  assert.ok(filter.includes("fontsize=163"), "key word should keep the emphasis size");
});

test("hero falls back to emphasisColor when preset omits heroColor", () => {
  const words = [{ text: "Lord", start: 0, end: 1, level: "hero", emphasize: true }];
  const filter = buildWordDrawtext({ words, w: 1080, h: 1920 }); // cinematic-default
  assert.ok(filter.includes("fontcolor=#F59E0B"), "hero should use emphasisColor by default");
});

test("preset-defined heroColor and heroSizeMult are honored", () => {
  // hero-bold defines explicit hero fields (uppercase preset).
  const words = [{ text: "Lord", start: 0, end: 1, level: "hero", emphasize: true }];
  const filter = buildWordDrawtext({ words, w: 1080, h: 1920, preset: "hero-bold" });
  const hero = resolveTypographyPreset("hero-bold");
  assert.ok(typeof hero.heroSizeMult === "number", "hero-bold should declare heroSizeMult");
  const expected = Math.round(1920 * hero.heroSizeMult);
  assert.ok(filter.includes(`fontsize=${expected}`), `hero size should be ${expected}`);
  assert.ok(filter.includes(`fontcolor=${hero.heroColor}`), "hero should use the preset heroColor");
});

test("no-regression: a key word still uses emphasis size, normal uses base", () => {
  const words = [
    { text: "the", start: 0, end: 1, level: "normal", emphasize: false },
    { text: "grace", start: 1, end: 2, level: "key", emphasize: true },
  ];
  const filter = buildWordDrawtext({ words, w: 1080, h: 1920 });
  assert.ok(filter.includes("fontsize=134"), "normal = round(0.07*1920) = 134");
  assert.ok(filter.includes("fontsize=163"), "key = round(0.085*1920) = 163");
});

test("legacy emphasize:true (no level) still maps to the emphasis size", () => {
  // Older callers (annotateEmphasis) set only emphasize, no level field.
  const words = [{ text: "Lord", start: 0, end: 1, emphasize: true }];
  const filter = buildWordDrawtext({ words, w: 1080, h: 1920 });
  assert.ok(filter.includes("fontsize=163"), "emphasize-only word keeps emphasis size, not hero");
});

// ─── Layout variety (Phase 2) ─────────────────────────────────────────────
// Optional `layout` positions text for vertical social video. Default "center"
// keeps the historical output byte-identical. Bottom layouts sit in a safe band
// (≈74% height) above the TikTok/Reels caption strip.

const sizeOf = (filter) => Number(filter.match(/fontsize=(\d+)/)[1]);

test("default layout is center (output unchanged)", () => {
  const words = [{ text: "Lord", start: 0, end: 1, level: "normal" }];
  const filter = buildWordDrawtext({ words, w: 1080, h: 1920 }); // cinematic-default, no motion
  assert.ok(filter.includes("x=(w-text_w)/2"));
  assert.ok(filter.includes("y=(h-text_h)/2"));
});

test("bottom-center anchors in the lower safe band, horizontally centered", () => {
  const words = [{ text: "Lord", start: 0, end: 1, level: "hero" }];
  const filter = buildWordDrawtext({ words, w: 1080, h: 1920, layout: "bottom-center" });
  assert.ok(filter.includes("x=(w-text_w)/2"), "stays horizontally centered");
  assert.ok(filter.includes("h*0.74"), "uses the lower safe band");
  assert.ok(!filter.includes("y=(h-text_h)/2"), "not vertically centered");
});

test("bottom-left uses the left safe margin and lower band", () => {
  const words = [{ text: "Lord", start: 0, end: 1, level: "hero" }];
  const filter = buildWordDrawtext({ words, w: 1080, h: 1920, layout: "bottom-left" });
  assert.ok(filter.includes("x=w*0.08"), "left safe margin");
  assert.ok(filter.includes("h*0.74"), "lower safe band");
});

test("center-large boosts size relative to center", () => {
  const words = [{ text: "Lord", start: 0, end: 1, level: "normal" }];
  const c = buildWordDrawtext({ words, w: 1080, h: 1920, preset: "cinematic-default" });
  const cl = buildWordDrawtext({ words, w: 1080, h: 1920, preset: "cinematic-default", layout: "center-large" });
  assert.ok(sizeOf(cl) > sizeOf(c), "center-large should render bigger");
});

test("staggered varies x by phraseIndex (left / center / right)", () => {
  const words = [
    { text: "aa", start: 0, end: 1, level: "normal", phraseIndex: 0 },
    { text: "bb", start: 1, end: 2, level: "normal", phraseIndex: 1 },
    { text: "cc", start: 2, end: 3, level: "normal", phraseIndex: 2 },
  ];
  const filter = buildWordDrawtext({ words, w: 1080, h: 1920, layout: "staggered" });
  assert.ok(filter.includes("x=w*0.10"), "phrase 0 → left");
  assert.ok(filter.includes("x=(w-text_w)/2"), "phrase 1 → center");
  assert.ok(filter.includes("x=w*0.90-text_w"), "phrase 2 → right");
});

test("unknown layout falls back to center", () => {
  const words = [{ text: "Lord", start: 0, end: 1, level: "normal" }];
  const filter = buildWordDrawtext({ words, w: 1080, h: 1920, layout: "bogus" });
  assert.ok(filter.includes("x=(w-text_w)/2"));
  assert.ok(filter.includes("y=(h-text_h)/2"));
});

test("explicit layout arg overrides a preset's own layout", () => {
  // hero-bold ships no layout (defaults center); arg forces bottom-center.
  const words = [{ text: "Lord", start: 0, end: 1, level: "hero" }];
  const filter = buildWordDrawtext({ words, w: 1080, h: 1920, preset: "hero-bold", layout: "bottom-center" });
  assert.ok(filter.includes("h*0.74"));
});

test("listLayouts returns the supported set", () => {
  assert.deepEqual(
    listLayouts().slice().sort(),
    ["bottom-center", "bottom-left", "center", "center-large", "staggered"],
  );
});

test("bottom layout integrates with rise-fade motion around the band baseline", () => {
  const words = [{ text: "Glory", start: 0, end: 1, level: "hero" }];
  const filter = buildWordDrawtext({ words, w: 1080, h: 1920, preset: "hero-bold", layout: "bottom-center" });
  assert.ok(filter.includes("h*0.74"), "rise-fade still anchored to the band");
  assert.ok(filter.includes("1-clip("), "rise easing preserved");
});

// ─── Depth / layered text (Phase 2b) ──────────────────────────────────────
// Optional `depth` renders a darker, offset ghost copy of each word BEHIND the
// main word, for the layered "words sit behind the subject" look. Off by
// default (single drawtext per word, no regression).

const drawCount = (filter) => (filter.match(/drawtext=/g) || []).length;

test("no depth by default — one drawtext per word", () => {
  const words = [{ text: "Lord", start: 0, end: 1, level: "hero" }];
  const filter = buildWordDrawtext({ words, w: 1080, h: 1920, preset: "cinematic-default" });
  assert.equal(drawCount(filter), 1);
  assert.ok(!filter.includes("black@0.5"));
});

test("depth renders a darker offset ghost behind each word", () => {
  const words = [{ text: "Lord", start: 0, end: 1, level: "hero" }];
  const filter = buildWordDrawtext({ words, w: 1080, h: 1920, preset: "cinematic-default", depth: true });
  assert.equal(drawCount(filter), 2, "one ghost + one main");
  assert.ok(filter.includes("black@0.5"), "ghost is a semi-transparent dark layer");
  assert.ok(filter.includes("x=(w-text_w)/2+11"), "ghost is horizontally offset (~1% w)");
  assert.ok(filter.indexOf("black@0.5") < filter.indexOf("fontcolor=#F59E0B"), "ghost drawn before (behind) the main word");
});

test("depth offset shifts y by the default vertical amount", () => {
  const words = [{ text: "Lord", start: 0, end: 1, level: "normal" }];
  const filter = buildWordDrawtext({ words, w: 1080, h: 1920, preset: "cinematic-default", depth: true });
  assert.ok(filter.includes("+23)"), "ghost y baseline offset (~1.2% h)");
});

test("depth accepts a custom offset/colour object", () => {
  const words = [{ text: "Lord", start: 0, end: 1, level: "normal" }];
  const filter = buildWordDrawtext({ words, w: 1080, h: 1920, preset: "cinematic-default", depth: { dx: 20, dy: 30, color: "navy", opacity: 0.4 } });
  assert.ok(filter.includes("x=(w-text_w)/2+20"));
  assert.ok(filter.includes("navy@0.4"));
});

test("depth composes with layout + rise-fade (both layers animate, in the band)", () => {
  const words = [{ text: "Glory", start: 0, end: 1, level: "hero" }];
  const filter = buildWordDrawtext({ words, w: 1080, h: 1920, preset: "hero-bold", layout: "bottom-center", depth: true });
  assert.equal(drawCount(filter), 2);
  assert.ok(filter.includes("h*0.74"), "both layers anchored in the safe band");
  assert.equal((filter.match(/alpha='clip\(/g) || []).length, 2, "both layers fade in");
});

test("depth:false stays off even if used as an explicit arg", () => {
  const words = [{ text: "Lord", start: 0, end: 1, level: "hero" }];
  const filter = buildWordDrawtext({ words, w: 1080, h: 1920, preset: "cinematic-default", depth: false });
  assert.equal(drawCount(filter), 1);
});

// ─── Ending fade (smart outro) ────────────────────────────────────────────
// buildEndingFade computes trailing fade-out windows so audio doesn't cut off
// sharp and the picture settles to black. Fades clamp to half the clip length.
import { buildEndingFade } from "../../src/lib/videoFilters.js";

test("buildEndingFade: typical clip uses default 1.5s audio / 0.6s video fades", () => {
  const f = buildEndingFade({ totalDuration: 20 });
  assert.equal(f.aFade, 1.5);
  assert.equal(f.vFade, 0.6);
  assert.equal(Number(f.aStart.toFixed(3)), 18.5);
  assert.equal(Number(f.vStart.toFixed(3)), 19.4);
});

test("buildEndingFade: short clips clamp fades to half the duration", () => {
  const f = buildEndingFade({ totalDuration: 2 });
  assert.equal(f.aFade, 1); // min(1.5, 2*0.5)
  assert.equal(f.vFade, 0.6); // min(0.6, 1.0)
  assert.equal(f.aStart, 1);
});

test("buildEndingFade: custom fade lengths respected", () => {
  const f = buildEndingFade({ totalDuration: 30, audioFadeSec: 3, videoFadeSec: 1 });
  assert.equal(f.aFade, 3);
  assert.equal(f.vFade, 1);
  assert.equal(f.aStart, 27);
  assert.equal(f.vStart, 29);
});

test("buildEndingFade: invalid/zero duration yields no fade", () => {
  for (const d of [0, -5, NaN, undefined, 0.05]) {
    const f = buildEndingFade({ totalDuration: d });
    assert.equal(f.aFade, 0);
    assert.equal(f.vFade, 0);
  }
});

describe("karaoke-pop preset", () => {
  test("is registered as a typography preset", () => {
    assert.ok(listTypographyPresets().includes("karaoke-pop"));
  });

  test("highlights the spoken word in magenta over a white phrase", () => {
    const p = resolveTypographyPreset("karaoke-pop");
    assert.equal(p.baseColor, "white");
    assert.equal(p.emphasisColor, "#FF00FF");
  });

  test("renders uppercase", () => {
    assert.equal(resolveTypographyPreset("karaoke-pop").uppercase, true);
  });

  test("carries legibility with a heavy outline, not a backdrop box", () => {
    const p = resolveTypographyPreset("karaoke-pop");
    assert.ok(p.borderWidth >= 6, "outline must be thick enough to read over busy footage");
    assert.equal(p.wordBox, false);
    assert.equal(p.lineBoxOpacity, 0);
  });

  test("recolours in place — the highlight must not resize and reflow the line", () => {
    const p = resolveTypographyPreset("karaoke-pop");
    assert.equal(p.emphasisSizeMult, p.baseSizeMult);
  });

  test("is offered as a renderable kinetic animation", () => {
    const a = resolveKineticAnimation("karaoke-pop");
    assert.equal(a.presetId, "karaoke-pop");
    assert.equal(a.renderable, true);
    assert.deepEqual(a.unsupported, []);
  });
});
