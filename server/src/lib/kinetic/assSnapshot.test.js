// Pins today's caption output byte for byte. A call that shares the screen with its crowd echo
// is placed by `phrase.clearBelow`; nothing else may change, so every document here (Story,
// Timeline, Ambient and Moments all draw through buildAss, and lyric videos with no echo through
// buildLyricAss) must hash exactly as it did before that rule existed.
// To re-bless after an intended change: UPDATE_ASS_SNAPSHOTS=1 node --test src/lib/kinetic/assSnapshot.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAss, EFFECTS } from "./ass.js";
import { buildLyricAss } from "../lyricVideo/lyricAss.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = path.join(HERE, "__fixtures__", "ass-snapshots.json");
const REFERENCE = path.join(HERE, "..", "lyricVideo", "__fixtures__", "my-time-no-late", "expected-lines.json");

const LOOKS = ["studio-lagos-night", "studio-gospel-gold", "studio-clean-white"];
const ENERGIES = ["calm", "lively", "wild"];
const SIZES = [["wide", 1280, 720, "default"], ["tall", 720, 1280, "default"], ["shorts", 720, 1280, "shorts"]];

const words = (text, t0) => text.split(" ").map((t, i) => ({ text: t, start: t0 + i * 0.3, end: t0 + i * 0.3 + 0.3 }));
const song = [
  ...words("Eh yeah eh yeah", 0.5), ...words("Dem say make I calm down", 3),
  ...words("Who talk say I no go shine", 8), ...words("My time no late my time no late", 12),
  ...words("Oya dance dance dance", 16), ...words("This one na celebration", 19),
  ...words("Ẹ ṣeun Jésù fún ìfẹ́ rẹ", 23), ...words("Mighty mighty mighty God of wonders forever", 27),
];
const heldLines = ["Eh yeah eh yeah", "Who talk say I no go shine", "Ẹ ṣeun Jésù fún ìfẹ́ rẹ", "My time no late"].map((text, i) => ({
  text, start: 1 + i * 3, end: 3 + i * 3, soft: i % 2 === 1, ...(i === 2 && { holdUntil: 9.5, reveal: 0.8 }),
}));

/** The reference song as a lyric project with every response line made a lead line (so no echo). */
function leadOnlyProject(look, energy, seed) {
  const expected = JSON.parse(fs.readFileSync(REFERENCE, "utf8"));
  const kinds = { intro: "intro", verse1: "verse", pre: "pre", chorus1: "chorus", verse2: "verse", bridge: "bridge", final: "final", outro: "outro" };
  return {
    title: "My Time No Late",
    look: { id: look, energy, seed },
    sections: [...new Set(expected.map((l) => l.section))].map((s) => ({ id: s, kind: kinds[s], label: s })),
    lines: expected.map((l, i) => ({ id: `l${i}`, sectionId: l.section, kind: l.kind === "soft" ? "soft" : "lead",
      text: l.text, words: l.words, start: l.start, end: l.end, effect: "auto", confidence: 1, flag: null })),
  };
}

/** Every pinned document, by name. */
function documents() {
  const docs = {};
  SIZES.forEach(([aspect, w, h, layout], ai) => {
    [null, ...Object.keys(EFFECTS)].forEach((effect, ei) => {
      const look = LOOKS[(ai + ei) % 3];
      const energy = ENERGIES[ei % 3];
      const overrides = effect ? Object.fromEntries(Array.from({ length: 40 }, (_, i) => [i, effect])) : {};
      docs[`words/${aspect}/${effect ?? "auto"}/${look}/${energy}`] = buildAss({ words: song, w, h, look, energy, seed: 1 + (ei % 2), layout, overrides, title: ei % 2 ? "Calm Down" : "" });
      docs[`lines/${aspect}/${effect ?? "auto"}/${look}/${energy}`] = buildAss({ lines: heldLines, w, h, look, energy, layout, overrides });
    });
    ENERGIES.forEach((energy, i) => {
      docs[`lyric/${aspect}/${LOOKS[i]}/${energy}`] = buildLyricAss(leadOnlyProject(LOOKS[i], energy, i + 1), { w, h, layout });
    });
  });
  return docs;
}

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

test("caption documents without a crowd echo are byte-identical to the pinned snapshot", () => {
  const hashes = Object.fromEntries(Object.entries(documents()).map(([k, v]) => [k, sha(v)]));
  if (process.env.UPDATE_ASS_SNAPSHOTS) {
    fs.mkdirSync(path.dirname(SNAPSHOT), { recursive: true });
    fs.writeFileSync(SNAPSHOT, `${JSON.stringify(hashes, null, 1)}\n`);
  }
  const pinned = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
  assert.deepEqual(Object.keys(hashes).sort(), Object.keys(pinned).sort());
  const changed = Object.keys(pinned).filter((k) => hashes[k] !== pinned[k]);
  assert.deepEqual(changed, [], `${changed.length} documents changed`);
});
