import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAss, EFFECTS } from "./ass.js";
import { resolveLook, FALLBACK_FONT } from "./looks.js";
import { widthAt } from "./text.js";

const W = 720;
const H = 1280;
const TOP = H * 0.11;
const BOTTOM = H * 0.75;
const RIGHT = W * 0.88; // the right 12% stays clear
const SLACK = 1.5; // rounding of \pos and \fs to whole pixels

const words = (text, t0) => text.split(" ").map((t, i) => ({ text: t, start: t0 + i * 0.3, end: t0 + i * 0.3 + 0.3 }));
const song = [
  ...words("Eh yeah eh yeah", 0.5), ...words("Dem say make I calm down", 3),
  ...words("Who talk say I no go shine", 8), ...words("My time no late my time no late", 12),
  ...words("Oya dance dance dance", 16), ...words("This one na celebration", 19),
  ...words("Ẹ ṣeun Jésù fún ìfẹ́ rẹ", 23), ...words("Mighty mighty mighty God of wonders forever", 27),
];

/** The font file behind a family name, for the look that drew the line. */
function fileFor(look, family) {
  for (const f of [look.body, look.hit, FALLBACK_FONT]) if (f.family === family) return f.file;
  throw new Error(`unknown family ${family}`);
}

const num = (re, s, fallback) => (re.exec(s) ? Number(re.exec(s)[1]) : fallback);

/**
 * A pessimistic ink box for one event: the text rectangle (width from the
 * engine's own helper, half-height 0.525 fs + outline), turned by its \frz,
 * at the pop-in's peak scale, with the 8 px the entry move starts lower.
 * Returns the highest and lowest pixel it can reach, and the right edge.
 */
function inkBox(line, look) {
  const head = line.match(/\{[^}]*\}/)[0];
  const text = line.slice(line.indexOf("{")).replace(/\{[^}]*\}/g, "").replace(/\\N/g, " ");
  const family = /\\fn([^\\}]+)/.exec(head)[1];
  const fs = num(/\\fs(\d+)/, head);
  const bord = num(/\\bord(\d+(?:\.\d+)?)/, head, 0);
  const rot = (num(/\\frz(-?\d+(?:\.\d+)?)/, head, 0) * Math.PI) / 180;
  const peak = num(/\\fscy(\d+)/, head, 100) / 100;
  const move = /\\move\((-?\d+),(-?\d+),(-?\d+),(-?\d+)/.exec(head);
  const pos = /\\pos\((-?\d+),(-?\d+)\)/.exec(head);
  const [x, y0, y1] = move ? [Number(move[3]), Number(move[2]), Number(move[4])] : [Number(pos[1]), Number(pos[2]), Number(pos[2])];
  const width = widthAt(fileFor(look, family), text.trim(), fs);
  const halfH = 0.525 * fs + bord;
  const vert = (width / 2) * Math.abs(Math.sin(rot)) + halfH * Math.abs(Math.cos(rot));
  const horiz = (width / 2) * Math.abs(Math.cos(rot)) + halfH * Math.abs(Math.sin(rot));
  return {
    top: Math.min(y0, y1) - peak * vert,
    bottom: Math.max(y0, y1) + peak * vert,
    right: x + peak * horiz,
    settledRight: x + horiz,
    text: text.trim(),
  };
}

/** A spark burst fans upwards from its origin by up to 1.4 r (r = 5% of the short side), drawn at 115%. */
function sparkTop(line) {
  const pos = /\\pos\((-?\d+),(-?\d+)\)/.exec(line);
  return Number(pos[2]) - 1.4 * Math.round(Math.min(W, H) * 0.05) * 1.15 - 4;
}

const LOOKS = ["studio-lagos-night", "studio-gospel-gold", "studio-clean-white"];
const ENERGIES = ["calm", "lively", "wild"];

test("estimated ink of every effect stays inside the Shorts band across looks, energies and seeds", () => {
  const worst = { top: Infinity, bottom: -Infinity, right: -Infinity };
  const rightBy = {};
  const bad = [];
  for (const effect of Object.keys(EFFECTS)) {
    const overrides = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [i, effect]));
    for (const lookId of LOOKS) {
      const look = resolveLook(lookId);
      for (const energy of ENERGIES) {
        for (let seed = 1; seed <= 12; seed += 1) {
          const ass = buildAss({ words: song, w: W, h: H, look: lookId, energy, seed, layout: "shorts", overrides, title: seed % 2 ? "Calm Down" : "" });
          for (const line of ass.split("\n").filter((l) => l.startsWith("Dialogue:"))) {
            const label = `${effect}/${lookId}/${energy}/seed ${seed}: ${line.slice(0, 160)}`;
            const clip = /\\clip\((-?\d+),(-?\d+),(-?\d+),(-?\d+)\)/.exec(line);
            if (clip) {
              assert.ok(Number(clip[2]) >= TOP - SLACK && Number(clip[4]) <= BOTTOM + SLACK, `clip ${label}`);
              continue;
            }
            if (/\\p1/.test(line)) {
              if (sparkTop(line) < TOP - SLACK) bad.push(`spark above band (${sparkTop(line).toFixed(1)}) ${label}`);
              continue;
            }
            const box = inkBox(line, look);
            worst.top = Math.min(worst.top, box.top);
            worst.bottom = Math.max(worst.bottom, box.bottom);
            worst.right = Math.max(worst.right, box.settledRight);
            rightBy[effect] = Math.max(rightBy[effect] ?? -Infinity, box.settledRight);
            if (box.settledRight > RIGHT + SLACK) bad.push(`ink into the right 12% (${box.settledRight.toFixed(1)} > ${RIGHT.toFixed(1)}) ${label}`);
            if (box.top < TOP - SLACK) bad.push(`ink above band (${box.top.toFixed(1)} < ${TOP.toFixed(1)}) ${label}`);
            if (box.bottom > BOTTOM + SLACK) bad.push(`ink below band (${box.bottom.toFixed(1)} > ${BOTTOM}) ${label}`);
          }
        }
      }
    }
  }
  const byEffect = Object.fromEntries(Object.keys(EFFECTS).map((e) => [e, bad.filter((b) => b.includes(`${e}/studio`)).length]));
  assert.equal(bad.length, 0, `${bad.length} lines leave the band ${JSON.stringify(byEffect)}\n${bad.slice(0, 4).join("\n")}`);
  if (process.env.SHOW_INK) console.log("worst ink extents", worst, { TOP, BOTTOM, RIGHT }, "right by effect", rightBy);
});
