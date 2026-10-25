import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STYLES, STYLE_IDS, CLASSIC_IDS, SHOWCASE_IDS, TEMPLATE_IDS, CLASSIC_LENGTHS, SHOWCASE_LENGTHS,
  resolveStyle, captionEnergyFor, isShowcase, familyOf, lengthsFor,
} from "./styles.js";
import { getEffect, FFMPEG_51_FILTERS } from "./effects/index.js";
import { isStudioLook } from "../kinetic/looks.js";

test("the four classic styles, then the four Showcase styles, in order", () => {
  assert.deepEqual(CLASSIC_IDS, ["glow", "celebrate", "hype", "gallery"]);
  assert.deepEqual(SHOWCASE_IDS, ["fellowship", "scrapbook", "partyPop", "premiere"]);
  assert.deepEqual(STYLE_IDS, [...CLASSIC_IDS, ...SHOWCASE_IDS]);
});

test("each style has a natural Energy that matches its feel", () => {
  const band = (id) => captionEnergyFor(STYLES[id].energy);
  assert.equal(band("glow"), "calm");
  assert.equal(band("gallery"), "lively");
  assert.equal(band("celebrate"), "lively");
  assert.equal(band("hype"), "wild");
  for (const s of Object.values(STYLES)) assert.ok(s.energy >= 0 && s.energy <= 1, s.id);
});

test("every palette entry names an existing effect of the right kind", () => {
  for (const s of Object.values(STYLES).filter((x) => x.family === "classic")) {
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

test("Showcase styles use only known templates, a real caption look and 5.1 grade filters", () => {
  for (const id of SHOWCASE_IDS) {
    const s = STYLES[id];
    assert.equal(s.family, "showcase");
    assert.ok(isStudioLook(s.look), `${id} look`);
    const entries = Object.entries(s.templates);
    assert.ok(entries.length >= 4, `${id} has a few templates`);
    for (const [t, w] of entries) {
      assert.ok(TEMPLATE_IDS.includes(t), `${id}: ${t}`);
      assert.ok(w > 0);
    }
    for (const f of s.grade.split(",")) assert.ok(FFMPEG_51_FILTERS.has(f.split("=")[0]), `${id} grade ${f}`);
    assert.ok(["blur", "paper", "colour", "dark"].includes(s.palette.backdrop));
    if (s.palette.backdrop === "colour") assert.ok(s.palette.blocks.length >= 4);
    assert.ok(s.energy >= 0 && s.energy <= 1);
  }
});

test("families and their lengths", () => {
  assert.equal(isShowcase("partyPop"), true);
  assert.equal(isShowcase("hype"), false);
  assert.equal(isShowcase("constructor"), false);
  assert.equal(familyOf("premiere"), "showcase");
  assert.equal(familyOf("glow"), "classic");
  assert.deepEqual(CLASSIC_LENGTHS, [15, 30, 60]);
  assert.deepEqual(SHOWCASE_LENGTHS, [30, 60, 90, 120, 180]);
  assert.deepEqual(lengthsFor("glow"), [15, 30, 60]);
  assert.deepEqual(lengthsFor("premiere"), [30, 60, 90, 120, 180]);
  assert.deepEqual(lengthsFor("nope"), [15, 30, 60]);
});
