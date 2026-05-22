import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolveTypographyPreset,
  listTypographyPresets,
  buildWordDrawtext,
  buildLineDrawtext,
} from "../../src/lib/videoFilters.js";
import { PROFILES } from "../../src/lib/voice/profiles.js";

test("listTypographyPresets returns the complete preset map", () => {
  const presets = listTypographyPresets();
  assert.ok(presets.includes("cinematic-default"));
  assert.ok(presets.includes("intimate-fade"));
  assert.ok(presets.includes("scripture-emphasis"));
  assert.ok(presets.includes("playful-pop"));
  assert.ok(presets.includes("worship-cinematic"));
});

test("every voice profile's recommendedTypographyPreset resolves to a real preset", () => {
  // This is the contract that makes Auto-Publish "auto-bake" — if a profile
  // recommends a preset name that doesn't exist, the renderer silently falls
  // back to cinematic-default and the user gets nothing they asked for.
  for (const profile of Object.values(PROFILES)) {
    const resolved = resolveTypographyPreset(profile.recommendedTypographyPreset);
    assert.ok(resolved, `${profile.category}: preset ${profile.recommendedTypographyPreset} did not resolve`);
    assert.equal(typeof resolved.baseSizeMult, "number", `${profile.category}: baseSizeMult missing`);
    assert.equal(typeof resolved.baseColor, "string", `${profile.category}: baseColor missing`);
  }
});

test("resolveTypographyPreset falls back to cinematic-default for unknown / empty input", () => {
  const fallback = resolveTypographyPreset("not-a-real-preset");
  assert.equal(fallback.baseColor, "white");
  const empty = resolveTypographyPreset("");
  assert.equal(empty.baseColor, "white");
  const nullish = resolveTypographyPreset(null);
  assert.equal(nullish.baseColor, "white");
});

test("resolveTypographyPreset is case-insensitive", () => {
  const upper = resolveTypographyPreset("CINEMATIC-DEFAULT");
  const mixed = resolveTypographyPreset("Scripture-Emphasis");
  assert.equal(upper.baseColor, "white");
  assert.equal(mixed.emphasisColor, "#FCD34D");
});

test("buildWordDrawtext honours preset emphasis colour", () => {
  const words = [
    { text: "Lord", start: 0, end: 0.6, emphasize: true },
    { text: "is", start: 0.6, end: 0.9 },
  ];
  const filter = buildWordDrawtext({ words, w: 1080, h: 1920, preset: "intimate-fade" });
  assert.ok(filter, "expected drawtext chain");
  // intimate-fade uses #FBBF24 for emphasis (amber-400) and #F5F1E6 for base.
  assert.ok(filter.includes("#FBBF24"), "emphasis colour from preset missing");
  assert.ok(filter.includes("#F5F1E6"), "base colour from preset missing");
});

test("buildWordDrawtext scripture-emphasis preset adds the box backdrop", () => {
  const words = [{ text: "Faith", start: 0, end: 1.0, emphasize: true }];
  const filter = buildWordDrawtext({ words, w: 1080, h: 1920, preset: "scripture-emphasis" });
  assert.ok(filter);
  assert.ok(filter.includes("box=1"), "scripture-emphasis should render a backdrop box");
});

test("buildWordDrawtext default preset (cinematic-default) has no word backdrop box", () => {
  const words = [{ text: "Be", start: 0, end: 0.4 }];
  const filter = buildWordDrawtext({ words, w: 1080, h: 1920 });
  assert.ok(filter);
  assert.ok(!filter.includes("box=1"), "default preset should not draw word backdrop");
});

test("buildLineDrawtext applies preset fontcolor and box opacity", () => {
  const filter = buildLineDrawtext({
    lines: ["The Lord is my shepherd"],
    w: 1080,
    h: 1920,
    preset: "worship-cinematic",
  });
  assert.ok(filter);
  // worship-cinematic baseColor is #FFF7ED (orange-50)
  assert.ok(filter.includes("#FFF7ED"), "worship-cinematic baseColor missing");
  // boxOpacity is 0.4
  assert.ok(filter.includes("@0.40"), "worship-cinematic boxOpacity missing");
});

test("buildLineDrawtext falls back gracefully when preset is omitted", () => {
  const filter = buildLineDrawtext({ lines: ["Hello world"], w: 1080, h: 1920 });
  assert.ok(filter);
  // Default cinematic-default → fontcolor white + 0.35 box opacity
  assert.ok(filter.includes("fontcolor=white"));
  assert.ok(filter.includes("@0.35"));
});
