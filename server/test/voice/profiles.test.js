import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PROFILES,
  DEFAULT_CATEGORY,
  listCategories,
  resolveProfile,
} from "../../src/lib/voice/profiles.js";

test("listCategories returns the full taxonomy", () => {
  const cats = listCategories();
  assert.ok(cats.includes("devotional"));
  assert.ok(cats.includes("prayer"));
  assert.ok(cats.includes("scripture"));
  assert.ok(cats.includes("kids"));
  assert.ok(cats.includes("worship"));
});

test("every profile declares required fields", () => {
  for (const cat of listCategories()) {
    const p = PROFILES[cat];
    assert.equal(p.category, cat, `category mismatch for ${cat}`);
    assert.ok(p.label && typeof p.label === "string", `${cat}: label missing`);
    assert.ok(Array.isArray(p.providerPreference) && p.providerPreference.length > 0, `${cat}: providerPreference missing`);
    assert.ok(p.edge?.voiceId, `${cat}: edge.voiceId missing`);
    assert.ok(p.recommendedTypographyPreset, `${cat}: typography preset missing`);
  }
});

test("resolveProfile is case-insensitive", () => {
  assert.equal(resolveProfile("PRAYER").category, "prayer");
  assert.equal(resolveProfile(" Prayer ").category, "prayer");
});

test("resolveProfile falls back to default on unknown category", () => {
  assert.equal(resolveProfile("nonsense").category, DEFAULT_CATEGORY);
  assert.equal(resolveProfile(undefined).category, DEFAULT_CATEGORY);
  assert.equal(resolveProfile(null).category, DEFAULT_CATEGORY);
  assert.equal(resolveProfile("").category, DEFAULT_CATEGORY);
});

test("PROFILES is frozen — accidental mutation throws in strict mode", () => {
  assert.throws(() => {
    PROFILES.prayer = { hijacked: true };
  });
});
