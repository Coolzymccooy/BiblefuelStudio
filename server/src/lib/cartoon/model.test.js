import { test } from "node:test";
import assert from "node:assert/strict";
import { cartoonFromScript, estimateFilm, CAST_DEFAULTS, IMAGE_USD } from "./model.js";
import { STYLES, DEFAULT_STYLE, styleId } from "./styles.js";
import { estimateTokens, usdForTokens } from "../videoGen/spend.js";
import { SEEDANCE_MODELS } from "../videoGen/providers/seedance.js";

const SCRIPT = `# The Lost Lamb
Verse: Luke 15:4
Style: Storybook

Cast:
- Eli: a shepherd boy. Voice: bright.

Scene: Hillside, wide
Eli: "Pip? Pip, where are you?"
Pip: "I am stuck here"
`;

test("cartoonFromScript builds the stored project shape", () => {
  const out = cartoonFromScript(SCRIPT);
  assert.equal(out.mode, "cartoon");
  assert.deepEqual(out.meta, { title: "The Lost Lamb", verse: { reference: "Luke 15:4", text: "" }, aspect: "portrait", style: "storybook" });
  assert.equal(out.source.markdown, SCRIPT);
  assert.ok(Array.isArray(out.source.ignored));
  assert.ok(Array.isArray(out.source.warnings));
  assert.ok(!Number.isNaN(Date.parse(out.source.parsedAt)));
  assert.deepEqual(out.scenes, [{ id: "s1", place: "Hillside", note: "wide" }]);
  assert.equal(out.shots.length, 2);
  assert.equal(out.shots[0].clip, null);
  assert.equal(out.shotListApproved, false);
  assert.ok(Number.isInteger(out.seed) && out.seed >= 1 && out.seed <= 2147483647);
  assert.match(out.music.bed, /^library:/);
  assert.deepEqual(out.captions, { enabled: true });
  assert.deepEqual(out.endCard, { text: "" });
  assert.equal(out.spentUsd, 0);
  assert.deepEqual(out.render, { status: "idle" });
  assert.equal(out.check.filmSec, out.check.storySec + 5.5);
  assert.ok(Array.isArray(out.warnings));
});

test("style defaults to family3d when missing or unknown", () => {
  assert.equal(cartoonFromScript("Scene: A\nEli: \"Hi\"\n").meta.style, "family3d");
  assert.equal(cartoonFromScript("Style: Watercolour dream\nScene: A\nEli: \"Hi\"\n").meta.style, "family3d");
});

test("cartoonFromScript fills cast for an unknown speaker with an empty look", () => {
  const out = cartoonFromScript(SCRIPT);
  assert.deepEqual(Object.keys(out.cast), ["Eli", "Pip"]);
  assert.deepEqual(out.cast.Eli, { name: "Eli", look: "a shepherd boy", voice: "bright", portrait: null, approved: false, shelfId: null });
  assert.deepEqual(out.cast.Pip, { name: "Pip", ...CAST_DEFAULTS });
  assert.equal(out.cast.Pip.look, "");
  assert.ok(out.warnings.some((w) => w.includes("Pip")));
});

function projectWith(shots, extra = {}) {
  return {
    meta: { aspect: "portrait" },
    cast: { Eli: { name: "Eli", approved: false, portrait: null }, Pip: { name: "Pip", approved: true, portrait: "p.png" } },
    shots,
    spentUsd: 0,
    ...extra,
  };
}

const mk = (id, seconds, clip = null) => ({ id, seconds, clip });

test("estimateFilm counts only shots without a done clip, and the images", () => {
  const project = projectWith([mk("sh1", 5), mk("sh2", 5), mk("sh3", 5), mk("sh4", 8, { status: "done" })]);
  const est = estimateFilm(project);
  const perShot = usdForTokens({
    model: SEEDANCE_MODELS.mini,
    resolution: "720p",
    tokens: estimateTokens({ durationSec: 5, ratio: "9:16", resolution: "720p" }),
  });
  assert.equal(est.clips, 3);
  assert.equal(est.seconds, 15);
  assert.ok(Math.abs(est.usd - perShot * 3) < 1e-9);
  assert.equal(est.images, 1);
  assert.equal(IMAGE_USD, 0.04);
  assert.ok(Math.abs(est.imageUsd - 0.04) < 1e-9);
  assert.deepEqual(est.shotIds, ["sh1", "sh2", "sh3"]);
  assert.equal(est.spentUsd, 0);
  assert.ok(Math.abs(est.totalUsd - est.usd) < 1e-9);
  assert.equal(est.benchmarkUsd, 10);
  assert.equal(est.overBenchmark, false);
});

test("estimateFilm limits to the requested shots and adds spend so far", () => {
  const project = projectWith([mk("sh1", 5), mk("sh2", 5, { status: "done" })], { spentUsd: 9.9 });
  const est = estimateFilm(project, ["sh2"]);
  assert.deepEqual(est.shotIds, ["sh2"]);
  assert.equal(est.clips, 1);
  assert.equal(est.spentUsd, 9.9);
  assert.ok(Math.abs(est.totalUsd - (9.9 + est.usd)) < 1e-9);
  assert.equal(est.overBenchmark, true);
});

test("styles: ids, labels and loose names map to an id", () => {
  assert.equal(DEFAULT_STYLE, "family3d");
  assert.ok(Object.isFrozen(STYLES));
  assert.deepEqual(Object.keys(STYLES), ["family3d", "storybook", "clay"]);
  assert.equal(styleId("family3d"), "family3d");
  assert.equal(styleId("  3D Family Film "), "family3d");
  assert.equal(styleId("3d"), "family3d");
  assert.equal(styleId("STORYBOOK"), "storybook");
  assert.equal(styleId("Claymation"), "clay");
  assert.equal(styleId("clay"), "clay");
  assert.equal(styleId("nonsense"), "family3d");
  assert.equal(styleId(null), "family3d");
  assert.equal(styleId(undefined), "family3d");
  for (const s of Object.values(STYLES)) assert.ok(!/pixar/i.test(`${s.label} ${s.prompt}`));
});
