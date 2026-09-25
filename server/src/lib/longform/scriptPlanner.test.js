import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { planLongformScript, parseOutline, _setLlmImpl, _resetLlmImpl, _setVerseLookupImpl, _resetVerseLookupImpl } from "./scriptPlanner.js";
import { longformTemplateById } from "./templates.js";

afterEach(() => { _resetLlmImpl(); _resetVerseLookupImpl(); });

const outlineJson = JSON.stringify({
  title: "Psalms for a Restless Night",
  summary: "Slow readings from the Psalms with quiet reflections.",
  sections: [
    { heading: "Welcome", reference: null, targetSec: 60 },
    { heading: "Psalm 23", reference: "Psalm 23:1-4", targetSec: 420 },
    { heading: "Closing blessing", reference: null, targetSec: 60 },
  ],
});

describe("section variety (a 12 min session must not say the same thing six times)", () => {
  const template = longformTemplateById("sleep-30");
  const outlineWithAngles = JSON.stringify({
    title: "T", summary: "S",
    sections: [
      { heading: "Welcome", reference: null, targetSec: 60, angle: "the door closing on the day" },
      { heading: "Psalm 23", reference: "Psalm 23:1-4", targetSec: 300, angle: "a shepherd counting his sheep at dusk" },
      { heading: "Psalm 4", reference: "Psalm 4:8", targetSec: 300, angle: "a lamp left burning in an empty room" },
    ],
  });

  test("parseOutline keeps each section's angle", () => {
    const out = parseOutline(outlineWithAngles);
    assert.equal(out.sections[1].angle, "a shepherd counting his sheep at dusk");
    // A model that omits the field must not break the plan.
    assert.equal(parseOutline(outlineJson).sections[0].angle, "");
  });

  test("the outline is asked for a distinct angle per section", async () => {
    const prompts = [];
    _setLlmImpl(async (p) => { prompts.push(p); return prompts.length === 1 ? outlineWithAngles : "reflection"; });
    _setVerseLookupImpl(async () => ({ verses: [{ text: "verse" }] }));
    await planLongformScript({ idea: "rest", template });
    assert.match(prompts[0], /angle/i, "the outline prompt asks for an angle");
    assert.match(prompts[0], /no two sections/i, "and forbids two sections sharing one");
  });

  test("each section is told its own angle and what the other sections already cover", async () => {
    const prompts = [];
    _setLlmImpl(async (p) => { prompts.push(p); return prompts.length === 1 ? outlineWithAngles : "reflection"; });
    _setVerseLookupImpl(async () => ({ verses: [{ text: "verse" }] }));
    await planLongformScript({ idea: "rest", template });
    const psalm23 = prompts.slice(1).find((p) => p.includes("Psalm 23"));
    assert.ok(psalm23, "a prompt was written for the Psalm 23 section");
    assert.match(psalm23, /a shepherd counting his sheep at dusk/, "it carries its own angle");
    assert.match(psalm23, /a lamp left burning in an empty room/, "and a sibling's angle to steer away from");
    assert.match(psalm23, /the door closing on the day/);
    assert.match(psalm23, /do not/i, "with an explicit do-not-repeat instruction");
    // The phrases that made the real 12 min session feel like five repeats.
    assert.match(psalm23, /you are not alone/i);
    assert.match(psalm23, /in this moment/i);
  });
});

describe("parseOutline", () => {
  test("parses JSON, tolerating a ```json fence", () => {
    const out = parseOutline("```json\n" + outlineJson + "\n```");
    assert.equal(out.title, "Psalms for a Restless Night");
    assert.equal(out.sections.length, 3);
    assert.equal(out.sections[1].reference, "Psalm 23:1-4");
  });
  test("throws a named error on garbage", () => {
    assert.throws(() => parseOutline("not json"), /outline/i);
  });
  test("tolerates null / non-object section items instead of throwing a TypeError", () => {
    const raw = JSON.stringify({ title: "T", summary: "", sections: [null, { heading: "Psalm 23", reference: "Psalm 23:1", targetSec: 120 }, "junk", { heading: "Close", targetSec: 60 }] });
    const out = parseOutline(raw);
    assert.equal(out.sections.length, 4);
    assert.deepEqual(out.sections[0], { heading: "Section", reference: null, targetSec: 60, angle: "" });
    assert.deepEqual(out.sections[2], { heading: "Section", reference: null, targetSec: 60, angle: "" });
    assert.equal(out.sections[1].reference, "Psalm 23:1");
  });
  test("still requires the minimum section count when every item is null", () => {
    assert.throws(() => parseOutline(JSON.stringify({ sections: [null, null] })), /at least 3 sections/);
  });
});

describe("planLongformScript", () => {
  test("fetches verse text from the Bible API and never lets the LLM write scripture", async () => {
    const prompts = [];
    _setLlmImpl(async (p) => {
      prompts.push(p);
      if (prompts.length === 1) return outlineJson;
      return "Rest now. You are held.";
    });
    const lookups = [];
    _setVerseLookupImpl(async (ref, tr) => {
      lookups.push([ref, tr]);
      return { ok: true, canonical: "Psalm 23:1-4", verses: [{ verse: 1, text: "The LORD is my shepherd; I shall not want." }, { verse: 2, text: "He maketh me to lie down in green pastures." }] };
    });
    const t = longformTemplateById("sleep-30");
    const plan = await planLongformScript({ idea: "psalms for when I can't sleep", template: t, translation: "kjv" });
    assert.deepEqual(lookups, [["Psalm 23:1-4", "kjv"]]);
    assert.equal(plan.sections.length, 3);
    const psalm = plan.sections[1];
    assert.equal(psalm.verseText, "The LORD is my shepherd; I shall not want. He maketh me to lie down in green pastures.");
    assert.match(psalm.text, /^Psalm 23:1-4\. The LORD is my shepherd/);
    assert.match(psalm.text, /Rest now\. You are held\.$/);
    assert.equal(plan.sections[0].text, "Rest now. You are held.");
    // section prompts carry the verse verbatim and the word budget (found by
    // content: sections are written concurrently, so prompt order is not fixed)
    const psalmPrompt = prompts.find((p) => /section "Psalm 23"/.test(p));
    assert.ok(psalmPrompt, "a section prompt was issued for Psalm 23");
    assert.match(psalmPrompt, /The LORD is my shepherd/);
    assert.match(psalmPrompt, /\b\d{2,4} words\b/);
    // outline prompt carries the idea, the template structure and the total budget
    assert.match(prompts[0], /can't sleep/);
    assert.match(prompts[0], /falling asleep/);
    assert.match(prompts[0], /1800/);
  });
  test("a verse lookup failure surfaces as a named error, not silent paraphrase", async () => {
    _setLlmImpl(async () => outlineJson);
    _setVerseLookupImpl(async () => { throw new Error("api.bible down"); });
    await assert.rejects(
      () => planLongformScript({ idea: "x", template: longformTemplateById("sleep-30") }),
      /Psalm 23:1-4.*api\.bible down/,
    );
  });
  // I6 — /draft has to finish inside Cloudflare's 100 s: sections are written
  // with bounded concurrency (peak ≤ 4, > 1) and come back in outline order.
  test("writes sections with bounded concurrency and preserves their order", async () => {
    const tenSections = JSON.stringify({
      title: "Ten", summary: "",
      sections: Array.from({ length: 10 }, (_, i) => ({ heading: `S${i}`, reference: null, targetSec: 60 })),
    });
    let inFlight = 0; let peak = 0; let calls = 0;
    _setLlmImpl(async (prompt) => {
      calls += 1;
      if (calls === 1) return tenSections;
      inFlight += 1; peak = Math.max(peak, inFlight);
      const m = /section "S(\d+)"/.exec(prompt);
      // Finish out of order: later sections resolve first.
      await new Promise((r) => setTimeout(r, 30 - Number(m[1]) * 2));
      inFlight -= 1;
      return `text for S${m[1]}`;
    });
    const plan = await planLongformScript({ idea: "x", template: longformTemplateById("sleep-30") });
    assert.ok(peak <= 4, `peak in-flight ${peak} must be ≤ 4`);
    assert.ok(peak > 1, `peak in-flight ${peak} must be > 1 (not sequential)`);
    assert.deepEqual(plan.sections.map((s) => s.heading), Array.from({ length: 10 }, (_, i) => `S${i}`));
    assert.deepEqual(plan.sections.map((s) => s.text), Array.from({ length: 10 }, (_, i) => `text for S${i}`));
  });
  test("targetSec override scales the outline budget", async () => {
    let seen = "";
    _setLlmImpl(async (p) => { if (!seen) seen = p; return outlineJson.replace(/"targetSec": ?\d+/g, '"targetSec": 60'); });
    _setVerseLookupImpl(async () => ({ ok: true, canonical: "Psalm 23:1-4", verses: [{ verse: 1, text: "v" }] }));
    await planLongformScript({ idea: "x", template: longformTemplateById("sleep-30"), targetSec: 600 });
    assert.match(seen, /600/);
  });
});
