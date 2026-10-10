import { test } from "node:test";
import assert from "node:assert/strict";
import { GenerateSchema } from "../../src/routes/series.js";

// PreviewSchema requires only `reference` (parts/translation default).
const base = { reference: "Psalm 23", parts: 2, translation: "KJV" };

test("a series can ask for a Studio look and an energy", () => {
  const input = GenerateSchema.parse({ ...base, typographyPreset: "studio-gospel-gold", captionEnergy: "calm" });
  assert.equal(input.typographyPreset, "studio-gospel-gold");
  assert.equal(input.captionEnergy, "calm");
});

test("an unknown energy is rejected", () => {
  assert.equal(GenerateSchema.safeParse({ ...base, captionEnergy: "loud" }).success, false);
});

test("energy is optional", () => {
  assert.equal(GenerateSchema.parse(base).captionEnergy, undefined);
});
