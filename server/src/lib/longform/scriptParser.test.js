import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parsePastedScript, isReferenceLine } from "./scriptParser.js";

const verses = { "Psalm 4:8": "I will both lay me down in peace, and sleep: for thou, LORD, only makest me dwell in safety.", "Isaiah 40:31": "But they that wait upon the LORD shall renew their strength." };
const lookup = async (ref) => { if (!verses[ref]) throw new Error("no such verse"); return verses[ref]; };

describe("isReferenceLine", () => {
  test("recognises a bare reference, bracketed, with ranges and numbered books", () => {
    for (const s of ["Psalm 4:8", "[Psalm 4:8]", "1 John 4:18", "Isaiah 40:28-31", "Song of Solomon 2:1", "(Psalm 23:1-3)"]) {
      assert.equal(isReferenceLine(s), true, s);
    }
  });
  test("rejects prose that merely contains a reference, and times", () => {
    for (const s of ["As Psalm 4:8 says, rest.", "Meet at 10:30", "Psalm", "# Psalm 4:8 heading"]) {
      assert.equal(isReferenceLine(s), false, s);
    }
  });
});

describe("parsePastedScript", () => {
  const script = `# Psalms for a Restless Mind

## Welcome
Settle in. **You are safe** here.
(soft music fades in)
Let your shoulders drop…

## Psalm 4
Psalm 4:8
[pause 8]
Read that again slowly. You dwell in safety.

---
Isaiah 40:31
Those who wait will not be put to shame. #rest #peace
- breathe in
- breathe out
`;

  test("splits on headings and rules, keeps heading text out of the narration, drops notes and markdown", async () => {
    const out = await parsePastedScript(script, { lookupVerses: lookup, wpm: 100 });
    assert.equal(out.title, "Psalms for a Restless Mind");
    assert.deepEqual(out.sections.map((s) => s.heading), ["Welcome", "Psalm 4", "Psalm 4", "Isaiah 40:31"]);
    const welcome = out.sections[0];
    assert.equal(welcome.text, "Settle in. You are safe here.\n\nLet your shoulders drop…");
    assert.equal(welcome.reference, null);
    assert.equal(welcome.verseText, "");
  });
  test("a bare reference line becomes verbatim scripture, prefixed into the narration text", async () => {
    const out = await parsePastedScript(script, { lookupVerses: lookup, wpm: 100 });
    const psalm = out.sections[1];
    assert.equal(psalm.reference, "Psalm 4:8");
    assert.equal(psalm.verseText, verses["Psalm 4:8"]);
    assert.equal(psalm.text, `Psalm 4:8. ${verses["Psalm 4:8"]}`);
    // An unheaded block after a rule takes its reference as the chapter title.
    const isaiah = out.sections[3];
    assert.equal(isaiah.heading, "Isaiah 40:31");
    assert.equal(isaiah.text, `Isaiah 40:31. ${verses["Isaiah 40:31"]} Those who wait will not be put to shame.\n\nbreathe in\n\nbreathe out`);
  });
  test("[pause N] splits the section into a continuation with a custom pause, without a new chapter", async () => {
    const out = await parsePastedScript(script, { lookupVerses: lookup, wpm: 100 });
    const cont = out.sections[2];
    assert.equal(cont.continuation, true);
    assert.equal(cont.pauseBeforeMs, 8000);
    assert.equal(cont.text, "Read that again slowly. You dwell in safety.");
    assert.equal(out.sections[1].continuation, undefined);
  });
  test("estimates targetSec from word count at the given wpm, including the verse", async () => {
    const out = await parsePastedScript("## One\nten words here to be spoken slowly by the voice", { lookupVerses: lookup, wpm: 120 });
    assert.equal(out.sections[0].targetSec, 5); // 10 words / 120 wpm = 5 s
  });
  test("a script with no headings is one section titled from its first line", async () => {
    const out = await parsePastedScript("Be still and know.\n\nThe night is not your enemy.", { lookupVerses: lookup });
    assert.equal(out.sections.length, 1);
    assert.equal(out.title, "Be still and know.");
    assert.equal(out.sections[0].heading, "Be still and know.");
  });
  test("a bare [pause] defaults to the template pause; a reference that fails lookup names the failure", async () => {
    const out = await parsePastedScript("## A\nfirst\n[pause]\nsecond", { lookupVerses: lookup, defaultPauseMs: 5000 });
    assert.equal(out.sections[1].pauseBeforeMs, 5000);
    await assert.rejects(() => parsePastedScript("## A\nJude 1:99", { lookupVerses: lookup }), /Jude 1:99/);
  });
  test("rejects an empty script by name and never returns an empty section", async () => {
    await assert.rejects(() => parsePastedScript("  \n(only a note)\n", { lookupVerses: lookup }), /nothing to narrate/i);
    const out = await parsePastedScript("## Empty\n\n## Real\nwords", { lookupVerses: lookup });
    assert.deepEqual(out.sections.map((s) => s.heading), ["Real"]);
  });
});
