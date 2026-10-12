import { test } from "node:test";
import assert from "node:assert/strict";
import { STYLES, STYLE_IDS, resolveStyle, captionEnergyFor } from "./styles.js";
import { getEffect } from "./effects/index.js";
import { isStudioLook } from "../kinetic/looks.js";

test("the four launch styles, in order", () => {
  assert.deepEqual(STYLE_IDS, ["glow", "celebrate", "hype", "gallery"]);
});

test("every palette entry names an existing effect of the right kind", () => {
  for (const s of Object.values(STYLES)) {
    for (const [kind, palette] of [["move", s.moves], ["entrance", s.entrances], ["overlay", s.overlays]]) {
      for (const [id, weight] of Object.entries(palette)) {
        assert.equal(getEffect(id)?.kind, kind, `${s.id}: ${id}`);
        assert.ok(weight > 0);
      }
    }
    assert.equal(getEffect(s.endOverlay)?.kind, "overlay", `${s.id} end overlay`);
  }
});

test("each style uses the spec's Studio look", () => {
  assert.equal(STYLES.glow.look, "studio-gospel-gold");
  assert.equal(STYLES.celebrate.look, "studio-lagos-night");
  assert.equal(STYLES.hype.look, "studio-lagos-night");
  assert.equal(STYLES.gallery.look, "studio-clean-white");
  for (const s of Object.values(STYLES)) assert.ok(isStudioLook(s.look));
});

test("Energy maps to the caption engine's three levels", () => {
  assert.equal(captionEnergyFor(0), "calm");
  assert.equal(captionEnergyFor(0.33), "calm");
  assert.equal(captionEnergyFor(0.34), "lively");
  assert.equal(captionEnergyFor(0.66), "lively");
  assert.equal(captionEnergyFor(0.67), "wild");
});

test("unknown style ids fall back to celebrate, ignoring the prototype chain", () => {
  assert.equal(resolveStyle("nope").id, "celebrate");
  assert.equal(resolveStyle("constructor").id, "celebrate");
  assert.equal(resolveStyle("glow").id, "glow");
});
