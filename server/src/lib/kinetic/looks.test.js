import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { LOOKS, FALLBACK_FONT, isStudioLook, resolveLook, resolveEnergy, listStudioLooks, drawtextPresetFor } from "./looks.js";
import { FONT_DIR, listTypographyPresets } from "../videoFilters.js";

test("every look's fonts are in the repo and its fallback preset exists", () => {
  for (const look of Object.values(LOOKS)) {
    for (const face of [look.body, look.hit]) {
      assert.ok(fs.existsSync(path.join(FONT_DIR, face.file)), `${look.id}: ${face.file}`);
      assert.match(face.colour, /^#[0-9A-F]{6}$/i);
    }
    assert.ok(listTypographyPresets().includes(look.fallbackPreset), `${look.id} fallback ${look.fallbackPreset}`);
  }
  assert.ok(fs.existsSync(path.join(FONT_DIR, FALLBACK_FONT.file)));
});

test("studio ids are prefixed and resolve; everything else is not a studio look", () => {
  assert.equal(isStudioLook("studio-lagos-night"), true);
  assert.equal(isStudioLook("studio-nope"), false);
  assert.equal(isStudioLook("marker"), false);
  assert.equal(isStudioLook(undefined), false);
  assert.equal(resolveLook("studio-gospel-gold").id, "gospel-gold");
  assert.equal(resolveLook("rubbish").id, "clean-white");
  assert.deepEqual(listStudioLooks().map((l) => l.id), ["studio-lagos-night", "studio-gospel-gold", "studio-clean-white"]);
});

test("energy falls back to the caller's default", () => {
  assert.equal(resolveEnergy("wild"), "wild");
  assert.equal(resolveEnergy("loud"), "lively");
  assert.equal(resolveEnergy(undefined, "calm"), "calm");
});

test("Gospel Gold's body is scaled up and synthesised bold italic", () => {
  const body = LOOKS["gospel-gold"].body;
  assert.equal(body.scale, 1.3);
  assert.equal(body.bold, true);
  assert.equal(body.italic, true);
  assert.equal(LOOKS["lagos-night"].body.scale, undefined);
});

test("drawtextPresetFor maps a Studio look to its fallback and leaves other presets alone", () => {
  assert.equal(drawtextPresetFor("studio-lagos-night"), "marker");
  assert.equal(drawtextPresetFor("studio-gospel-gold"), "scripture-emphasis");
  assert.equal(drawtextPresetFor("hero-bold"), "hero-bold");
  assert.equal(drawtextPresetFor(undefined), undefined);
});
