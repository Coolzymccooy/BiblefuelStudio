// server/src/lib/lyricVideo/renderPlan.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRenderAss } from "./renderPlan.js";
import { buildLyricAss } from "./lyricAss.js";
import { parseInkEvents, bandHideWindows, captionsEnd } from "./captionBands.js";
import { planBranding, bandGeometry } from "./brandingPlan.js";
import { brandingEvents } from "./brandingAss.js";
import { resolveLook } from "../kinetic/looks.js";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__", "my-time-no-late");
const expected = JSON.parse(fs.readFileSync(path.join(FIX, "expected-lines.json"), "utf8"));
const sectionIds = [...new Set(expected.map((l) => l.section))];
const project = {
  title: "My Time No Late",
  artist: "Sthill Waters",
  look: { id: "studio-lagos-night", energy: "wild", seed: 2026 },
  song: { file: "/s/song.m4a", durationSec: 175 },
  timing: { audibleEnd: 174.9 },
  sections: sectionIds.map((s) => ({ id: s, kind: "verse", label: s })),
  lines: expected.map((l, i) => ({ id: `l${i}`, sectionId: l.section, kind: l.kind === "response" ? "response" : "lead",
    text: l.text, words: l.words, start: l.start, end: l.end, effect: "auto", confidence: 1, flag: null })),
};
const LOGO = { file: "/b/logo.png", width: 400, height: 100, opacity: 0.85 };
const OPTIONS = { logo: true, intro: true, endCard: true };

/** What buildRenderAss should produce, worked out step by step from the parts. */
function expectedFor(p, { width: w, height: h, aspect, options, logo, shortsTrim }) {
  const captions = buildLyricAss(p, { w, h, layout: aspect === "portrait" ? "shorts" : "default" });
  const events = parseInkEvents(captions);
  const geometry = bandGeometry({ w, h, logo: logo ? { width: logo.width, height: logo.height } : null });
  const plan = planBranding({
    durationSec: p.song.durationSec, audibleEnd: p.timing?.audibleEnd, captionsEnd: captionsEnd(events),
    hideWindows: bandHideWindows(events, { bandBottom: geometry.bandBottom }),
    options, hasLogo: Boolean(logo), artist: p.artist, shortsTrim, aspect, lines: p.lines,
  });
  const look = resolveLook(p.look?.id || "studio-lagos-night");
  const lines = brandingEvents({ plan, geometry, look, title: p.title, artist: p.artist, w, h });
  return { captions, plan, geometry, lines };
}

describe("buildRenderAss", () => {
  test("a portrait render: Shorts captions, then the branding lines, under the captions' header", async () => {
    const opts = { width: 720, height: 1280, aspect: "portrait", options: OPTIONS, logo: LOGO, shortsTrim: false };
    const want = expectedFor(project, opts);
    const { ass, plan, geometry } = await buildRenderAss(project, opts);
    assert.deepEqual(plan, want.plan);
    assert.deepEqual(geometry, want.geometry);
    assert.ok(want.lines.length > 0, "the fixture has branding to draw");
    assert.equal(ass, `${want.captions.slice(0, -1)}\n${want.lines.join("\n")}\n`);
    // Exactly one header: the captions'.
    assert.equal(ass.match(/\[Script Info\]/g).length, 1);
    assert.equal(ass.match(/\[Events\]/g).length, 1);
  });

  test("the end card and tail extension come through: the song ends right after its last line", async () => {
    const { plan, ass } = await buildRenderAss(project, { width: 720, height: 1280, aspect: "portrait", options: OPTIONS, logo: LOGO });
    assert.equal(plan.totalSec, 178);
    assert.ok(plan.endCard, "the end card is planned");
    assert.ok(plan.showLogo);
    assert.match(ass, /\\1a&H21&/, "the end card dim is in the document");
  });

  test("a landscape render uses the default caption layout", async () => {
    const opts = { width: 1280, height: 720, aspect: "landscape", options: OPTIONS, logo: null };
    const want = expectedFor(project, opts);
    const { ass, plan, geometry } = await buildRenderAss(project, opts);
    assert.ok(ass.startsWith(want.captions.slice(0, -1)));
    assert.deepEqual(plan, want.plan);
    assert.deepEqual(geometry, want.geometry);
  });

  test("no logo: no logo box and the plan does not show one, but the name and end card still come", async () => {
    const { plan, geometry, ass } = await buildRenderAss(project, { width: 720, height: 1280, aspect: "portrait", options: OPTIONS, logo: null });
    assert.equal(geometry.logo, null);
    assert.equal(plan.showLogo, false);
    assert.ok(plan.endCard);
    assert.match(ass, /Song by Sthill Waters/);
  });

  test("the toggles reach the plan: no end card, no extension", async () => {
    const { plan, ass } = await buildRenderAss(project, {
      width: 720, height: 1280, aspect: "portrait", options: { logo: true, intro: true, endCard: false }, logo: LOGO,
    });
    assert.equal(plan.endCard, null);
    assert.equal(plan.totalSec, 175);
    assert.doesNotMatch(ass, /\\1a&H21&/);
  });

  test("the Shorts trim reaches the plan for a portrait song of 3:05", async () => {
    const long = { ...project, song: { ...project.song, durationSec: 185 }, timing: { audibleEnd: 184 } };
    const { plan } = await buildRenderAss(long, { width: 720, height: 1280, aspect: "portrait", options: OPTIONS, logo: LOGO, shortsTrim: true });
    assert.equal(plan.totalSec, 179);
    assert.equal(plan.audio.fadeSec, 3);
  });

  test("a missing audible end is passed through, not invented", async () => {
    const noTiming = { ...project, timing: undefined };
    const opts = { width: 720, height: 1280, aspect: "portrait", options: OPTIONS, logo: LOGO };
    const { plan } = await buildRenderAss(noTiming, opts);
    assert.deepEqual(plan, expectedFor(noTiming, opts).plan);
  });

  test("a caption high on the screen makes the band step aside", async () => {
    const { plan } = await buildRenderAss(project, { width: 720, height: 1280, aspect: "portrait", options: OPTIONS, logo: LOGO });
    const events = parseInkEvents(buildLyricAss(project, { w: 720, h: 1280, layout: "shorts" }));
    const high = events.filter((e) => e.top < bandGeometry({ w: 720, h: 1280, logo: LOGO }).bandBottom);
    for (const e of high) {
      for (const [a, b] of plan.bandPieces) assert.ok(e.end <= a || e.start >= b, `piece [${a}, ${b}] overlaps a high caption at ${e.start}`);
    }
  });

  test("no placed line gives an empty document, as buildLyricAss does", async () => {
    const empty = { ...project, lines: project.lines.map((l) => ({ ...l, words: [] })) };
    const r = await buildRenderAss(empty, { width: 720, height: 1280, aspect: "portrait", options: OPTIONS, logo: LOGO });
    assert.equal(r.ass, "");
    assert.equal(r.plan, null);
  });

  test("a logo without a known size is measured, and one that cannot be read is left out", async () => {
    const { plan, geometry } = await buildRenderAss(project, {
      width: 720, height: 1280, aspect: "portrait", options: OPTIONS, logo: { file: path.join(FIX, "no-such-logo.png"), opacity: 1 },
    });
    assert.equal(geometry.logo, null);
    assert.equal(plan.showLogo, false);
  });
});
