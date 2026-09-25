import test from "node:test";
import assert from "node:assert/strict";
import { defaultDropTimes, normaliseDrops, voiceDrops } from "./drops.js";
import { deriveMovements } from "./movements.js";

test("defaultDropTimes lands a verse every fifteen minutes", () => {
  const times = defaultDropTimes(7200);
  assert.deepEqual(times.slice(0, 3), [900_000, 1_800_000, 2_700_000]);
  assert.equal(times.length, 7, "two hours holds seven drops before the tail guard");
});

test("defaultDropTimes leaves the final minute clear", () => {
  // A verse starting at 1:59:55 would be cut off mid-sentence.
  const times = defaultDropTimes(7200);
  assert.ok(times[times.length - 1] <= (7200 - 60) * 1000);
});

test("defaultDropTimes honours a custom cadence and yields nothing for a short runtime", () => {
  assert.deepEqual(defaultDropTimes(600, 120), [120_000, 240_000, 360_000, 480_000]);
  assert.deepEqual(defaultDropTimes(60, 900), []);
});

test("normaliseDrops sorts out-of-order input and clamps past the end", () => {
  const drops = normaliseDrops([
    { atMs: 60_000, reference: "John 3:16" },
    { atMs: 10_000, reference: "Psalm 23:1" },
    { atMs: 999_999_999, reference: "Isaiah 40:31" },
  ], { targetSec: 300 });

  assert.deepEqual(drops.map((d) => d.reference), ["Psalm 23:1", "John 3:16", "Isaiah 40:31"]);
  assert.equal(drops[2].atMs, 299_999, "clamped inside the runtime");
  assert.ok(drops.every((d) => d.id && d.translation === "kjv"));
});

test("normaliseDrops drops entries with no reference", () => {
  const drops = normaliseDrops([{ atMs: 0, reference: "  " }, { atMs: 1, reference: "Psalm 1:1" }], { targetSec: 60 });
  assert.equal(drops.length, 1);
});

test("voiceDrops fills verbatim text and audio, and one bad reference does not sink the rest", async () => {
  const project = {
    translation: "kjv",
    drops: [
      { id: "a", atMs: 0, reference: "Psalm 23:1", status: "pending" },
      { id: "b", atMs: 1000, reference: "Nowhere 9:9", status: "pending" },
      { id: "c", atMs: 2000, reference: "John 3:16", status: "pending" },
    ],
  };

  const out = await voiceDrops(project, {
    lookupVerses: async (ref) => {
      if (ref === "Nowhere 9:9") throw new Error("no such book");
      return { ok: true, verses: [{ text: `text of ${ref}` }] };
    },
    synthesize: async ({ text }) => ({ ok: true, file: `/tmp/${text.replace(/\W+/g, "_")}.mp3` }),
    probeAudioDurationSec: async () => 4.2,
  });

  assert.equal(out[0].status, "done");
  assert.equal(out[0].text, "text of Psalm 23:1", "verse text must be verbatim from the lookup");
  assert.equal(out[0].durationMs, 4200);
  assert.equal(out[1].status, "error");
  assert.match(out[1].error, /no such book/);
  assert.equal(out[2].status, "done", "a failure must not stop later drops");
});

test("voiceDrops leaves already-voiced drops alone unless forced", async () => {
  const project = { drops: [{ id: "a", atMs: 0, reference: "Psalm 23:1", status: "done", audioPath: "/old.mp3" }] };
  let calls = 0;
  const deps = {
    lookupVerses: async () => { calls += 1; return { verses: [{ text: "x" }] }; },
    synthesize: async () => ({ ok: true, file: "/new.mp3" }),
    probeAudioDurationSec: async () => 1,
  };

  const kept = await voiceDrops(project, deps);
  assert.equal(calls, 0);
  assert.equal(kept[0].audioPath, "/old.mp3");

  const redone = await voiceDrops(project, { ...deps, force: true });
  assert.equal(calls, 1);
  assert.equal(redone[0].audioPath, "/new.mp3");
});

test("voiceDrops treats an empty lookup as a failure rather than silent silence", async () => {
  const out = await voiceDrops(
    { drops: [{ id: "a", atMs: 0, reference: "Psalm 23:1" }] },
    {
      lookupVerses: async () => ({ ok: true, verses: [] }),
      synthesize: async () => ({ ok: true, file: "/x.mp3" }),
      probeAudioDurationSec: async () => 1,
    },
  );
  assert.equal(out[0].status, "error");
  assert.match(out[0].error, /no verse text/);
});

test("deriveMovements gives one movement per drop, cutting at the midpoints between them", () => {
  const movements = deriveMovements({
    targetSec: 600,
    theme: "peace",
    drops: [{ atMs: 100_000, reference: "Psalm 23:1" }, { atMs: 300_000, reference: "John 14:27" }],
  });

  assert.equal(movements.length, 2);
  assert.equal(movements[0].startMs, 0);
  assert.equal(movements[0].endMs, 200_000, "midpoint of 100s and 300s");
  assert.equal(movements[1].startMs, 200_000);
  assert.equal(movements[1].endMs, 600_000, "last movement runs to the end");
  assert.match(movements[0].imagePrompt, /peace/);
  assert.match(movements[0].imagePrompt, /Psalm 23:1/);
});

test("deriveMovements still yields one movement when there are no drops", () => {
  const movements = deriveMovements({ targetSec: 600, theme: "stillness", drops: [] });
  assert.equal(movements.length, 1);
  assert.equal(movements[0].startMs, 0);
  assert.equal(movements[0].endMs, 600_000);
});

test("deriveMovements keeps images already generated when drops are retimed", () => {
  const first = deriveMovements({
    targetSec: 600, theme: "peace",
    drops: [{ atMs: 100_000, reference: "Psalm 23:1" }],
  });
  first[0].imagePath = "/img/a.png";
  first[0].imageStatus = "done";

  const retimed = deriveMovements({
    targetSec: 600, theme: "peace", movements: first,
    drops: [{ atMs: 150_000, reference: "Psalm 23:1" }],
  });

  assert.equal(retimed[0].imagePath, "/img/a.png", "regenerating costs image quota");
  assert.equal(retimed[0].id, first[0].id);
});
