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
    // section prompts carry the verse verbatim and the word budget
    assert.match(prompts[2], /The LORD is my shepherd/);
    assert.match(prompts[2], /\b\d{2,4} words\b/);
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
  test("targetSec override scales the outline budget", async () => {
    let seen = "";
    _setLlmImpl(async (p) => { if (!seen) seen = p; return outlineJson.replace(/"targetSec": ?\d+/g, '"targetSec": 60'); });
    _setVerseLookupImpl(async () => ({ ok: true, canonical: "Psalm 23:1-4", verses: [{ verse: 1, text: "v" }] }));
    await planLongformScript({ idea: "x", template: longformTemplateById("sleep-30"), targetSec: 600 });
    assert.match(seen, /600/);
  });
});
