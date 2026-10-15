import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planBranding, shortsTrimOffer, bandGeometry,
  SHORTS_TRIM_SEC, TAIL_SEC, END_CARD_SEC, INTRO, FADE,
} from "./brandingPlan.js";

const on = { logo: true, intro: true, endCard: true };
const off = { logo: false, intro: false, endCard: false };
const base = { durationSec: 120, audibleEnd: 118, captionsEnd: 110, hideWindows: [], options: on, hasLogo: true, artist: "Sthill Waters", shortsTrim: false };

test("constants match the spec", () => {
  assert.equal(SHORTS_TRIM_SEC, 179);
  assert.equal(TAIL_SEC, 3);
  assert.equal(END_CARD_SEC, 4);
  assert.deepEqual(INTRO, [0.8, 7.4]);
  assert.equal(FADE, 0.25);
});

test("a song with time after its last line keeps its length; the end card takes the last 4 s", () => {
  const p = planBranding(base);
  assert.equal(p.totalSec, 120);
  assert.deepEqual(p.endCard, { start: 116, end: 120 });
  assert.deepEqual(p.audio, { inputSec: 120, padToSec: 120, fadeFromSec: 0, fadeSec: 0 });
  assert.deepEqual(p.bandPieces, [[0, 116]]);
  assert.deepEqual(p.intro, [[0.8, 7.4]]);
  assert.deepEqual(p.wordmark, [[0, 0.8], [7.4, 116]].filter(([a, b]) => b - a >= 1));
  assert.equal(p.showLogo, true);
});

test("a song that ends right after its last line runs 3 s longer, and the end card waits for the captions", () => {
  const p = planBranding({ ...base, captionsEnd: 119, audibleEnd: 119.9 });
  assert.equal(p.totalSec, 123);
  assert.deepEqual(p.endCard, { start: 119.2, end: 123 });
  assert.deepEqual(p.audio, { inputSec: 120, padToSec: 123, fadeFromSec: 118.5, fadeSec: 1.5 });
});

test("an extended video with a naturally quiet ending is not faded", () => {
  const p = planBranding({ ...base, captionsEnd: 119, audibleEnd: 118 });
  assert.equal(p.totalSec, 123);
  assert.deepEqual(p.audio, { inputSec: 120, padToSec: 123, fadeFromSec: 0, fadeSec: 0 });
});

test("without an end card the video is never extended, however short the tail", () => {
  const p = planBranding({ ...base, captionsEnd: 119.5, audibleEnd: 120, options: { ...on, endCard: false } });
  assert.equal(p.totalSec, 120);
  assert.equal(p.endCard, null);
  assert.equal(p.audio.fadeSec, 0);
  assert.deepEqual(p.bandPieces, [[0, 120]], "the band covers the whole video");
});

test("the end card is dropped when under 2 s would remain", () => {
  // captions run past the audio (121 s): the video grows to 123 s, but the card would start at
  // 121.2 and leave only 1.8 s
  const p = planBranding({ ...base, captionsEnd: 121, audibleEnd: 118 });
  assert.equal(p.totalSec, 123);
  assert.equal(p.endCard, null);
  assert.deepEqual(p.bandPieces, [[0, 123]]);
});

test("the band steps aside while captions reach it", () => {
  const p = planBranding({ ...base, hideWindows: [[3, 5], [40, 40.5]] });
  assert.deepEqual(p.bandPieces, [[0, 3], [5, 40], [40.5, 116]]);
  // 0.8-3 is 2.2 s long, so it keeps the credit too; the brief's example listed only [5, 7.4]
  assert.deepEqual(p.intro, [[0.8, 3], [5, 7.4]]);
  assert.deepEqual(p.wordmark, [[7.4, 40], [40.5, 116]]);
});

test("intro pieces under 1.5 s are dropped", () => {
  const p = planBranding({ ...base, hideWindows: [[2, 6.5]] });
  assert.deepEqual(p.intro, [], "0.8-2 is 1.2 s and 6.5-7.4 is 0.9 s");
});

test("when no intro piece can show, the name takes its place instead of leaving the logo bare", () => {
  const p = planBranding({ ...base, hideWindows: [[2, 6.5]] });
  assert.deepEqual(p.intro, []);
  assert.deepEqual(p.wordmark, [[0, 2], [6.5, 116]]);
});

test("a non-finite captionsEnd is treated as 0", () => {
  for (const captionsEnd of [NaN, undefined, Infinity]) {
    const p = planBranding({ ...base, captionsEnd });
    assert.deepEqual(p.endCard, { start: 116, end: 120 });
    assert.ok(p.bandPieces.length > 0);
    assert.equal(p.totalSec, 120);
  }
});

test("missing options mean all on; non-boolean fields take their default", () => {
  const all = planBranding(base);
  assert.deepEqual(planBranding({ ...base, options: null }), all);
  assert.deepEqual(planBranding({ ...base, options: undefined }), all);
  assert.deepEqual(planBranding({ ...base, options: {} }), all);
  assert.deepEqual(planBranding({ ...base, options: { logo: "no", intro: 0, endCard: null } }), all);
  const noCard = planBranding({ ...base, options: { endCard: false } });
  assert.equal(noCard.endCard, null);
  assert.deepEqual(noCard.bandPieces, [[0, 120]]);
});

test("band pieces under 1 s are dropped", () => {
  const p = planBranding({ ...base, hideWindows: [[0.5, 50], [50.5, 60]] });
  assert.deepEqual(p.bandPieces, [[60, 116]]);
});

test("hide windows that are unsorted, overlapping or outside the video are tolerated", () => {
  const p = planBranding({ ...base, hideWindows: [[50, 60], [10, 20], [15, 25], [-5, 0.5], [200, 210]] });
  assert.deepEqual(p.bandPieces, [[0.5, 10], [25, 50], [60, 116]]);
});

test("the Shorts trim cuts to 2:59 with a 3 s fade, and only when no line would be cut", () => {
  const lines = [{ end: 170 }, { end: 178.4 }];
  assert.deepEqual(shortsTrimOffer({ aspect: "portrait", durationSec: 185, lines }), { offered: true, allowed: true, reason: "" });
  assert.equal(shortsTrimOffer({ aspect: "portrait", durationSec: 185, lines: [{ end: 178.6 }] }).allowed, false);
  assert.equal(shortsTrimOffer({ aspect: "landscape", durationSec: 185, lines }).offered, false);
  const p = planBranding({ ...base, durationSec: 185, captionsEnd: 178.9, shortsTrim: true, aspect: "portrait", lines });
  assert.equal(p.totalSec, 179);
  assert.deepEqual(p.audio, { inputSec: 179, padToSec: 179, fadeFromSec: 176, fadeSec: 3 });
  assert.equal(p.endCard, null, "under 2 s remain after the captions");
});

test("the Shorts trim offer reasons are plain sentences", () => {
  const lines = [{ end: 100 }];
  assert.equal(shortsTrimOffer({ aspect: "portrait", durationSec: 185, lines }).reason, "");
  assert.deepEqual(
    shortsTrimOffer({ aspect: "portrait", durationSec: 185, lines: [{ end: 179 }] }),
    { offered: true, allowed: false, reason: "A lyric line ends after 2:58, so trimming would cut it." },
  );
  assert.deepEqual(
    shortsTrimOffer({ aspect: "square", durationSec: 185, lines }),
    { offered: false, allowed: false, reason: "Only for portrait songs between 3:00 and 3:10." },
  );
});

test("the Shorts trim offer window is 180 to 190 s inclusive", () => {
  const offered = (d) => shortsTrimOffer({ aspect: "portrait", durationSec: d, lines: [] }).offered;
  assert.equal(offered(179.9), false);
  assert.equal(offered(180), true);
  assert.equal(offered(190), true);
  assert.equal(offered(190.1), false);
});

test("lines without a finite end do not block the trim", () => {
  const lines = [{ end: NaN }, {}, { end: null }, { end: 170 }];
  assert.equal(shortsTrimOffer({ aspect: "portrait", durationSec: 185, lines }).allowed, true);
});

test("a line ending exactly at 178.5 is allowed", () => {
  assert.equal(shortsTrimOffer({ aspect: "portrait", durationSec: 185, lines: [{ end: 178.5 }] }).allowed, true);
});

test("a trim that is not allowed is planned as if there were no trim", () => {
  const p = planBranding({
    ...base, durationSec: 185, captionsEnd: 180, audibleEnd: 184, shortsTrim: true, aspect: "portrait", lines: [{ end: 180 }],
  });
  assert.equal(p.totalSec, 185);
  assert.deepEqual(p.audio, { inputSec: 185, padToSec: 185, fadeFromSec: 0, fadeSec: 0 });
});

test("a trim on a non-portrait video is planned as if there were no trim", () => {
  const p = planBranding({ ...base, durationSec: 185, captionsEnd: 170, shortsTrim: true, aspect: "landscape", lines: [] });
  assert.equal(p.totalSec, 185);
});

test("a trim without aspect or lines is not allowed", () => {
  assert.equal(planBranding({ ...base, durationSec: 185, shortsTrim: true }).totalSec, 185);
});

test("all options off: no pieces, no end card, no extension", () => {
  const p = planBranding({ ...base, captionsEnd: 119.5, audibleEnd: 120, options: off });
  assert.equal(p.totalSec, 120);
  assert.deepEqual(p.bandPieces, []);
  assert.deepEqual(p.intro, []);
  assert.deepEqual(p.wordmark, []);
  assert.equal(p.showLogo, false);
  assert.equal(p.endCard, null);
  assert.deepEqual(p.audio, { inputSec: 120, padToSec: 120, fadeFromSec: 0, fadeSec: 0 });
});

test("the intro credit shows with the logo off, around the hide windows", () => {
  const p = planBranding({ ...base, options: { ...on, logo: false }, hideWindows: [[3, 5]] });
  assert.deepEqual(p.bandPieces, []);
  assert.deepEqual(p.wordmark, []);
  assert.deepEqual(p.intro, [[0.8, 3], [5, 7.4]]);
});

test("no logo uploaded: showLogo is false while the pieces still exist", () => {
  const p = planBranding({ ...base, hasLogo: false });
  assert.equal(p.showLogo, false);
  assert.deepEqual(p.bandPieces, [[0, 116]]);
  assert.deepEqual(p.intro, [[0.8, 7.4]]);
  assert.deepEqual(p.wordmark, [[7.4, 116]]);
});

test("a blank artist leaves no wordmark, but the logo band remains", () => {
  for (const artist of ["", "   ", undefined, null]) {
    const p = planBranding({ ...base, artist });
    assert.deepEqual(p.wordmark, [], `artist ${JSON.stringify(artist)}`);
    assert.deepEqual(p.bandPieces, [[0, 116]]);
  }
});

test("with the intro off the wordmark runs the whole band", () => {
  const p = planBranding({ ...base, options: { ...on, intro: false } });
  assert.deepEqual(p.intro, []);
  assert.deepEqual(p.wordmark, [[0, 116]]);
});

test("every list is sorted and non-overlapping, and times carry at most 2 decimals", () => {
  const p = planBranding({ ...base, captionsEnd: 119.123, audibleEnd: 119.99, hideWindows: [[3.333, 5.678], [40.001, 41.499]] });
  for (const list of [p.bandPieces, p.intro, p.wordmark]) {
    list.forEach(([a, b], i) => {
      assert.ok(b > a);
      if (i > 0) assert.ok(a >= list[i - 1][1]);
    });
  }
  const times = [...p.bandPieces.flat(), ...p.intro.flat(), ...p.wordmark.flat(), p.endCard.start, p.endCard.end, p.totalSec, p.audio.fadeFromSec];
  for (const t of times) assert.equal(t, Number(t.toFixed(2)));
  assert.equal(p.endCard.start, 119.32);
});

test("bandGeometry at 720x1280 for a 512x256 logo (tall)", () => {
  // top 0.115*1280 = 147.2; left 0.04*720 = 28.8; logoH 0.055*1280 = 70.4 -> even 70 (boxH)
  // logo width = min(3*70 = 210, round(70*512/256) = 140) = 140 (even)
  // logo = { x: round(28.8) = 29, y: round(147.2) = 147, w: 140, h: 70 }
  // text.x = round(28.8 + 140 + 0.015*720) = round(179.6) = 180; text.y = round(147.2 + 35) = 182
  // text.fs = round(0.026*1280 = 33.28) = 33; bandBottom = round(147.2 + 70 + 12.8) = 230
  assert.deepEqual(bandGeometry({ w: 720, h: 1280, logo: { width: 512, height: 256 } }), {
    logo: { x: 29, y: 147, w: 140, h: 70 },
    text: { x: 180, y: 182, fs: 33 },
    bandBottom: 230,
  });
});

test("bandGeometry at 1280x720 for a 512x256 logo (wide)", () => {
  // top 0.05*720 = 36; left 0.04*1280 = 51.2; logoH 0.08*720 = 57.6 -> even 58 (boxH)
  // logo width = min(174, round(58*2) = 116) = 116 (even)
  // logo = { x: round(51.2) = 51, y: 36, w: 116, h: 58 }
  // text.x = round(51.2 + 116 + 0.012*1280) = round(182.56) = 183; text.y = 36 + 29 = 65
  // text.fs = round(0.036*720 = 25.92) = 26; bandBottom = round(36 + 58 + 7.2) = 101
  assert.deepEqual(bandGeometry({ w: 1280, h: 720, logo: { width: 512, height: 256 } }), {
    logo: { x: 51, y: 36, w: 116, h: 58 },
    text: { x: 183, y: 65, fs: 26 },
    bandBottom: 101,
  });
});

test("bandGeometry treats square frames as wide", () => {
  // 1000x1000: top 50, left 40, logoH 80 (boxH 80), width min(240, 160) = 160, text.x = round(40 + 160 + 12) = 212
  const g = bandGeometry({ w: 1000, h: 1000, logo: { width: 512, height: 256 } });
  assert.deepEqual(g.logo, { x: 40, y: 50, w: 160, h: 80 });
  assert.equal(g.text.x, 212);
  assert.equal(g.text.fs, 36);
  assert.equal(g.bandBottom, 140);
});

test("a very wide logo is capped at 3 times the box height", () => {
  // 1280x720: boxH 58; a 1000x100 logo would be 580 wide, so it is capped at 174
  const g = bandGeometry({ w: 1280, h: 720, logo: { width: 1000, height: 100 } });
  assert.equal(g.logo.w, 174);
  assert.equal(g.logo.h, 58);
});

test("a tall logo gets a narrow, even box", () => {
  // 1280x720: boxH 58; a 100x290 logo is round(58*100/290) = 20, already even
  const g = bandGeometry({ w: 1280, h: 720, logo: { width: 100, height: 290 } });
  assert.equal(g.logo.w, 20);
});

test("with no logo the band is the same size and the text starts at the left margin", () => {
  // 1280x720: text.x = round(51.2) = 51; y and bandBottom as with a logo
  assert.deepEqual(bandGeometry({ w: 1280, h: 720, logo: null }), {
    logo: null,
    text: { x: 51, y: 65, fs: 26 },
    bandBottom: 101,
  });
});
