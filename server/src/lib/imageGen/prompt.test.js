/**
 * Unit tests for prompt builder + style anchor selection.
 * Run: node --test server/src/lib/imageGen/prompt.test.js
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildBiblePrompt,
  buildBibleNegativePrompt,
  chooseStyleAnchor,
  distillAtmosphere,
  normalizeSeed,
  STYLE_ANCHORS_LIST,
} from "./prompt.js";

describe("normalizeSeed", () => {
  test("numeric seeds pass through (positive, clamped to int32)", () => {
    assert.equal(normalizeSeed(42), 42);
    assert.equal(normalizeSeed(0), 0);
    // Negative & floats are absoluted + floored.
    assert.equal(normalizeSeed(-7), 7);
    assert.equal(normalizeSeed(3.9), 3);
  });

  test("string seeds are deterministic", () => {
    assert.equal(normalizeSeed("john-3"), normalizeSeed("john-3"));
    assert.notEqual(normalizeSeed("john-3"), normalizeSeed("john-4"));
  });

  test("empty/null seed produces a stable fallback (not NaN)", () => {
    assert.equal(normalizeSeed(undefined), normalizeSeed(null));
    assert.ok(Number.isFinite(normalizeSeed(undefined)));
  });

  test("seed stays within positive 31-bit range", () => {
    for (const v of ["abcdef", "x".repeat(200), 2 ** 40]) {
      const n = normalizeSeed(v);
      assert.ok(n >= 0 && n < 0x7fffffff, `out of range: ${n}`);
    }
  });
});

describe("chooseStyleAnchor", () => {
  test("same seed → same anchor (series visual consistency)", () => {
    assert.equal(chooseStyleAnchor("series_abc"), chooseStyleAnchor("series_abc"));
  });

  test("returns one of the curated anchors", () => {
    const anchor = chooseStyleAnchor("series_abc");
    assert.ok(STYLE_ANCHORS_LIST.includes(anchor));
  });

  test("never mentions people, faces, jesus, etc.", () => {
    for (const anchor of STYLE_ANCHORS_LIST) {
      const lower = anchor.toLowerCase();
      assert.ok(!/jesus|moses|apostle|disciple|figure|face|person|portrait/.test(lower),
        `anchor leaks figure terms: ${anchor}`);
    }
  });
});

describe("distillAtmosphere", () => {
  test("light-themed verse → warm light atmosphere", () => {
    const out = distillAtmosphere("Let there be light, and the morning shines.");
    assert.match(out, /golden|warm/);
  });

  test("water-themed verse → calm sea atmosphere", () => {
    const out = distillAtmosphere("He stilled the stormy sea and the waves obeyed.");
    // Storm has higher priority than sea.
    assert.match(out, /storm|sea/);
  });

  test("empty input → empty output", () => {
    assert.equal(distillAtmosphere(""), "");
    assert.equal(distillAtmosphere(null), "");
  });
});

describe("buildBiblePrompt", () => {
  test("always includes the no-people directive", () => {
    const prompt = buildBiblePrompt({ verseText: "For God so loved the world", seriesSeed: "s1" });
    assert.match(prompt.toLowerCase(), /no people, no faces/);
  });

  test("never injects the raw verse text (figures would leak)", () => {
    // Verse mentions a name that we don't want rendered as a face.
    const prompt = buildBiblePrompt({ verseText: "Jesus wept at the tomb of Lazarus.", seriesSeed: "s2" });
    assert.ok(!/jesus|lazarus/i.test(prompt), `verse name leaked into prompt: ${prompt}`);
  });

  test("same seriesSeed → same prompt (deterministic across parts)", () => {
    const a = buildBiblePrompt({ verseText: "Light", seriesSeed: "S_abc" });
    const b = buildBiblePrompt({ verseText: "Light", seriesSeed: "S_abc" });
    assert.equal(a, b);
  });

  test("different beat types produce different prompts", () => {
    const hook = buildBiblePrompt({ beatType: "hook", verseText: "Light", seriesSeed: "x" });
    const verse = buildBiblePrompt({ beatType: "verse", verseText: "Light", seriesSeed: "x" });
    const reflection = buildBiblePrompt({ beatType: "reflection", verseText: "Light", seriesSeed: "x" });
    assert.notEqual(hook, verse);
    assert.notEqual(verse, reflection);
  });

  test("explicit styleAnchor overrides seed-derived anchor", () => {
    const custom = "neon cyberpunk style, electric blue";
    const prompt = buildBiblePrompt({ verseText: "Light", styleAnchor: custom, seriesSeed: "y" });
    assert.match(prompt, /neon cyberpunk/);
  });
});

describe("buildBibleNegativePrompt", () => {
  test("lists figure/face terms (so SDXL-class models exclude them)", () => {
    const neg = buildBibleNegativePrompt().toLowerCase();
    assert.match(neg, /people/);
    assert.match(neg, /faces/);
    assert.match(neg, /jesus/);
    assert.match(neg, /text/);
    assert.match(neg, /watermark/);
  });
});
