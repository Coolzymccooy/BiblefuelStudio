import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAss, EFFECTS } from "./ass.js";
import { resolveLook } from "./looks.js";
import { inkBox, sparkTop as sparkTopAt } from "./inkTestkit.js";

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

const sparkTop = (line) => sparkTopAt(line, W, H);

const LOOKS = ["studio-lagos-night", "studio-gospel-gold", "studio-clean-white"];
const ENERGIES = ["calm", "lively", "wild"];
const songLines = [
  "Eh yeah eh yeah", "Dem say make I calm down", "Who talk say I no go shine", "My time no late my time no late",
  "Oya dance dance dance", "This one na celebration", "Ẹ ṣeun Jésù fún ìfẹ́ rẹ", "Mighty mighty mighty God of wonders forever",
];

/** Check every dialogue line of one document against the Shorts band, recording breaches in `bad`. */
function auditAss({ ass, look, tag, bad, worst, rightBy, effect }) {
  for (const line of ass.split("\n").filter((l) => l.startsWith("Dialogue:"))) {
    const label = `${tag}: ${line.slice(0, 160)}`;
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
          auditAss({ ass, look, tag: `${effect}/${lookId}/${energy}/seed ${seed}`, bad, worst, rightBy, effect });
        }
      }
    }
  }
  const byEffect = Object.fromEntries(Object.keys(EFFECTS).map((e) => [e, bad.filter((b) => b.includes(`${e}/studio`)).length]));
  assert.equal(bad.length, 0, `${bad.length} lines leave the band ${JSON.stringify(byEffect)}\n${bad.slice(0, 4).join("\n")}`);
  if (process.env.SHOW_INK) console.log("worst ink extents", worst, { TOP, BOTTOM, RIGHT }, "right by effect", rightBy);
});

test("soft (Caveat) lines of every effect also stay inside the Shorts band", () => {
  const lines = [];
  let t = 0.5;
  for (const text of songLines) {
    lines.push({ text, start: t, end: t + 2.4, soft: true });
    t += 3;
  }
  const bad = [];
  const worst = { top: Infinity, bottom: -Infinity, right: -Infinity };
  const rightBy = {};
  let caveat = 0;
  for (const effect of Object.keys(EFFECTS)) {
    const overrides = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [i, effect]));
    for (const lookId of LOOKS) {
      const look = resolveLook(lookId);
      for (let seed = 1; seed <= 3; seed += 1) {
        const ass = buildAss({ lines, w: W, h: H, look: lookId, energy: "wild", seed, layout: "shorts", overrides });
        if (/\\fnCaveat/.test(ass)) caveat += 1;
        auditAss({ ass, look, tag: `soft ${effect}/${lookId}/wild/seed ${seed}`, bad, worst, rightBy, effect });
      }
    }
  }
  assert.ok(caveat > 0, "the soft song never drew a Caveat line");
  assert.equal(bad.length, 0, `${bad.length} soft lines leave the band\n${bad.slice(0, 4).join("\n")}`);
});
