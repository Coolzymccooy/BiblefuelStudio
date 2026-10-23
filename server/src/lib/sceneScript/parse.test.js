import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseSceneScript } from "./parse.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const GRACE = fs.readFileSync(path.join(here, "__fixtures__", "grace-made-me.md"), "utf8");

const SPOKEN = [
  // Scene 1
  "Look at me today…",
  "You may see strength.",
  "You may see success.",
  "You may see someone who has everything figured out.",
  "But you don't know the battles that brought me here.",
  // Scene 2
  "There were nights I almost gave up.",
  "Doors that closed in my face.",
  "Mistakes I thought would define me forever.",
  "But there was something greater than my weakness…",
  "The grace of God.",
  // Scene 3
  "The Apostle Paul declared:",
  "But by the grace of God I am what I am: and his grace which was bestowed upon me was not in vain…",
  "First Corinthians, chapter fifteen, verse ten.",
  // Scene 4
  "Grace did not mean Paul stopped working.",
  "Grace gave his labour a purpose.",
  "He worked with everything he had…",
  "But he never took the glory.",
  "Because behind every achievement,",
  "Behind every second chance,",
  "Behind every victory…",
  "God's grace was working.",
  // Scene 5
  "So when they ask me how I survived…",
  "How I kept going…",
  "How I became who I am today…",
  "My answer will remain the same:",
  "NOT BY MY STRENGTH.",
  "NOT BY MY WISDOM.",
  "BUT BY THE GRACE OF GOD!",
  // Scene 6
  "I am not self-made.",
  "I am grace-made.",
  "And His grace upon my life…",
  "Will not be in vain.",
];

describe("parseSceneScript on the Grace Made Me fixture", () => {
  const { script, warnings } = parseSceneScript(GRACE);

  test("reads the project facts", () => {
    assert.equal(script.meta.title, "Grace Made Me");
    assert.equal(script.meta.reference, "1 Corinthians 15:10");
    assert.equal(script.meta.targetSec, 90);
    assert.equal(script.meta.aspect, "portrait");
    assert.ok(script.meta.notes.some((n) => /Afro-soul/.test(n)));
  });

  test("finds six scenes with their windows and visuals", () => {
    assert.deepEqual(script.scenes.map((s) => [s.title, s.targetStart, s.targetEnd]), [
      ["The Hook", 0, 12],
      ["The Revelation", 12, 27],
      ["The Scripture", 27, 46],
      ["The Transformation", 46, 65],
      ["The Declaration", 65, 80],
      ["The Final Message", 80, 90],
    ]);
    assert.equal(script.scenes[0].visual, "A man standing alone in the darkness. A narrow beam of golden light falls across his face.");
    assert.ok(script.scenes.every((s) => s.visual));
  });

  test("speaks exactly the author's words, in order", () => {
    const spoken = script.lines.filter((l) => l.kind !== "chant").map((l) => l.text);
    assert.deepEqual(spoken, SPOKEN);
  });

  test("never speaks a direction, a tag or a title", () => {
    const all = script.lines.map((l) => l.text).join(" ");
    for (const banned of ["Visual", "Narrator", "Scene", "Final screen", "0:00", "TITLE", "Music"]) {
      assert.ok(!all.includes(banned), `spoken text contains "${banned}"`);
    }
  });

  test("marks emphasis, scripture and the reference", () => {
    const byText = (t) => script.lines.find((l) => l.text === t);
    assert.equal(byText("The grace of God.").emphasis, true);
    assert.equal(byText("NOT BY MY STRENGTH.").emphasis, true);
    assert.equal(byText("You may see strength.").emphasis, false);
    const quote = script.lines.find((l) => l.kind === "scripture");
    assert.match(quote.text, /^But by the grace of God I am what I am/);
    assert.equal(quote.speaker, "Scripture");
    const ref = script.lines.find((l) => l.kind === "reference");
    assert.equal(ref.text, "First Corinthians, chapter fifteen, verse ten.");
    assert.equal(ref.reference, "1 Corinthians 15:10");
  });

  test("keeps each speaker's tone note without speaking it", () => {
    const first = script.lines[0];
    assert.equal(first.speaker, "Narrator");
    assert.equal(first.tone, "deep, emotional voice");
    assert.equal(script.lines.find((l) => l.text === "So when they ask me how I survived…").tone, "bold and uplifting");
  });

  test("places the ensemble chant after the reference and at the end", () => {
    const chants = script.lines.filter((l) => l.kind === "chant");
    assert.equal(chants.length, 2);
    assert.equal(chants[0].text, "By His grace… I am what I am.");
    assert.equal(chants[0].speaker, "Ensemble");
    const idx = script.lines.indexOf(chants[0]);
    assert.equal(script.lines[idx - 1].kind, "reference");
    assert.equal(script.lines.at(-1), chants[1]);
  });

  test("reads the end card", () => {
    assert.deepEqual(script.endCard, { reference: "1 CORINTHIANS 15:10", text: "BY THE GRACE OF GOD I AM WHAT I AM." });
  });

  test("reads the music cues, the heartbeat and the drop", () => {
    const cues = script.music.cues.map((c) => [c.from, c.to, c.mood, c.sceneIds.join(",")]);
    assert.deepEqual(cues, [
      [0, 27, "Emotional reflection", "s1,s2"],
      [27, 65, "Grace revealed", "s3,s4"],
      [65, 80, "Victorious declaration", "s5"],
      [80, 90, "Music softens to piano and choir.", "s6"],
    ]);
    assert.ok(script.music.cues[0].sfx.includes("heartbeat"));
    assert.equal(script.music.drops.length, 1);
    const target = script.lines.find((l) => l.id === script.music.drops[0].beforeLineId);
    assert.equal(target.text, "BUT BY THE GRACE OF GOD!");
  });

  test("takes voice hints from the recommendations", () => {
    assert.equal(script.voiceHints.Narrator.gender, "male");
    assert.equal(script.voiceHints.Scripture.gender, "female");
    assert.ok(script.voiceHints.Ensemble.children);
  });

  test("accounts for every non-blank line as used or ignored", () => {
    const lines = GRACE.split(/\r?\n/);
    const nonBlank = lines.map((l, i) => (l.trim() ? i + 1 : null)).filter(Boolean);
    const seen = new Set([...script.source.used, ...script.source.ignored.map((x) => x.lineNo)]);
    assert.deepEqual(nonBlank.filter((n) => !seen.has(n)), []);
    const images = script.source.ignored.filter((x) => x.reason === "image link").map((x) => x.lineNo);
    assert.deepEqual(images, [19, 131]);
  });

  test("raises no warnings on a well-formed script", () => {
    assert.deepEqual(warnings, []);
  });
});

describe("parseSceneScript edge cases", () => {
  test("assumes the narrator when a scene has no speaker tag", () => {
    const { script, warnings } = parseSceneScript([
      "### Scene 1 — Opening (0:00–0:08)",
      "*Visual: A river at dawn.*",
      "\"The Lord is my shepherd.\"",
    ].join("\n"));
    assert.equal(script.lines[0].speaker, "Narrator");
    assert.equal(script.lines[0].text, "The Lord is my shepherd.");
    assert.ok(warnings.some((w) => w.code === "NO_SPEAKER"));
  });

  test("makes one cue per scene when there is no music section", () => {
    const { script } = parseSceneScript([
      "### Scene 1 — Calm (0:00–0:10)",
      "*Visual: A field.*",
      "**Narrator:**",
      "\"Be still.\"",
      "### Scene 2 — Rising (0:10–0:20)",
      "*Visual: A mountain.*",
      "**Narrator:**",
      "\"And know.\"",
    ].join("\n"));
    assert.deepEqual(script.music.cues.map((c) => [c.mood, c.sceneIds.join()]), [["Calm", "s1"], ["Rising", "s2"]]);
  });

  test("warns about a scene with no visual and ignores stage directions", () => {
    const { script, warnings } = parseSceneScript([
      "### Scene 1 — Opening",
      "**Narrator:**",
      "(pause)",
      "[soft music]",
      "\"Peace be with you.\"",
    ].join("\n"));
    assert.deepEqual(script.lines.map((l) => l.text), ["Peace be with you."]);
    assert.ok(warnings.some((w) => w.code === "NO_VISUAL"));
    assert.deepEqual(script.source.ignored.map((x) => x.reason), ["stage direction", "stage direction"]);
  });

  test("gives every new speaker tag its own speaker", () => {
    const { script } = parseSceneScript([
      "### Scene 1 — Voices (0:00–0:10)",
      "*Visual: A choir.*",
      "**Child (soft):**",
      "\"Jesus loves me.\"",
      "**Narrator:** \"This I know.\"",
    ].join("\n"));
    assert.deepEqual(script.lines.map((l) => [l.speaker, l.tone, l.text]), [
      ["Child", "soft", "Jesus loves me."],
      ["Narrator", null, "This I know."],
    ]);
    assert.deepEqual(script.speakers.map((s) => s.name), ["Narrator", "Scripture", "Ensemble", "Child"]);
  });

  test("a Scripture tag inside a scene picks the Scripture voice", () => {
    const { script } = parseSceneScript([
      "**Scripture: 1 Corinthians 15:10**",
      "### Scene 1 — The Word (0:00–0:10)",
      "*Visual: An open Bible.*",
      "**Scripture:**",
      "\"By the grace of God I am what I am.\"",
      "Scripture: \"His grace was not in vain.\"",
    ].join("\n"));
    assert.equal(script.meta.reference, "1 Corinthians 15:10");
    assert.deepEqual(script.lines.map((l) => [l.speaker, l.text]), [
      ["Scripture", "By the grace of God I am what I am."],
      ["Scripture", "His grace was not in vain."],
    ]);
  });

  test("returns an empty script with a warning for text with no scenes", () => {
    const { script, warnings } = parseSceneScript("Just a paragraph about grace.");
    assert.equal(script.scenes.length, 0);
    assert.ok(warnings.some((w) => w.code === "NO_SCENES"));
  });
});

describe("parseSceneScript on hostile input", () => {
  const timed = (md) => {
    const t0 = performance.now();
    const out = parseSceneScript(md);
    return { ...out, ms: performance.now() - t0 };
  };
  const spaces = " ".repeat(450);
  // Just under the line limit: the old tag and heading patterns took seconds on these.
  const run = " ".repeat(1990);

  for (const [name, line] of [["heading", `###${run}x`], ["bold tag", `**${run}x`], ["plain tag", `A${run}x`]]) {
    test(`a ${name} with a long run of spaces parses in milliseconds`, () => {
      const { ms } = timed(`### Scene 1\n${line}`);
      assert.ok(ms < 500, `took ${ms} ms`);
    });
  }

  test("spaces inside a tag still read as the tag", () => {
    const { script } = parseSceneScript(`###${spaces}Scene${spaces}1\n**Narrator${spaces}(soft)${spaces}:**${spaces}"Grace${spaces}found me."`);
    assert.deepEqual([script.lines[0].speaker, script.lines[0].tone, script.lines[0].text], ["Narrator", "soft", "Grace found me."]);
  });

  test("repeated keywords under the line limit stay fast", () => {
    const md = [
      "### Scene 1",
      "*Visual: " + "a ".repeat(990) + "*",
      "### Notes",
      "Repeat " + "say ".repeat(480),
      "### Music",
      "0:00–0:10 — " + "drop ".repeat(390),
    ].join("\n");
    const { ms } = timed(md);
    assert.ok(ms < 500, `took ${ms} ms`);
  });

  test("sets aside a line over the limit with a warning", () => {
    const { script, warnings } = parseSceneScript(`### Scene 1\n**Narrator:** "${"word ".repeat(500)}"\n**Narrator:** "Still here."`);
    assert.deepEqual(script.lines.map((l) => l.text), ["Still here."]);
    assert.ok(warnings.some((w) => w.code === "LINE_TOO_LONG"));
  });
});
