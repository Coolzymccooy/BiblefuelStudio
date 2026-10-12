import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { suggestStatements, _setLlmImpl, _resetLlmImpl, _setLookupImpl, _resetLookupImpl } from "./statements.js";

afterEach(() => { _resetLlmImpl(); _resetLookupImpl(); });

const json = (o) => JSON.stringify(o);

test("AI JSON becomes clean, clamped statements", async () => {
  let prompt = "";
  _setLlmImpl(async (p) => {
    prompt = p;
    return json({ title: "Happy 40th, Tolu!", statements: ["40 years of grace", "Still rising", "  ", "x".repeat(80), "Celebrate", "Extra", "More"], verseReference: "" });
  });
  const s = await suggestStatements({ occasion: "birthday", details: { name: "Tolu", milestone: "40th" }, lengthSec: 15 });
  assert.equal(s.source, "ai");
  assert.equal(s.title, "Happy 40th, Tolu!");
  assert.deepEqual(s.statements, ["40 years of grace", "Still rising", "Celebrate"]);
  assert.match(prompt, /Tolu/);
  assert.match(prompt, /3 statements/);
  assert.equal(s.verse, undefined, "birthday is not a church occasion");
});

test("JSON inside a code fence or prose is still read", async () => {
  _setLlmImpl(async () => "Here you go:\n```json\n" + json({ title: "T", statements: ["A", "B"] }) + "\n```");
  const s = await suggestStatements({ occasion: "fun", details: {}, lengthSec: 30 });
  assert.equal(s.source, "ai");
  assert.deepEqual(s.statements, ["A", "B"]);
});

test("malformed output falls back to the occasion's templates", async () => {
  _setLlmImpl(async () => "I cannot help with that.");
  const s = await suggestStatements({ occasion: "birthday", details: { name: "Tolu" }, lengthSec: 15 });
  assert.equal(s.source, "template");
  assert.equal(s.title, "Happy birthday, Tolu!");
  assert.ok(s.statements.length >= 1 && s.statements.length <= 3);
});

test("a timeout falls back to the templates", async () => {
  _setLlmImpl(() => new Promise(() => {}));
  const s = await suggestStatements({ occasion: "memorial", details: { name: "Mama" }, lengthSec: 30, timeoutMs: 30 });
  assert.equal(s.source, "template");
  assert.equal(s.title, "In loving memory of Mama");
});

test("an LLM error falls back to the templates", async () => {
  _setLlmImpl(async () => { throw new Error("network"); });
  const s = await suggestStatements({ occasion: "sermon", details: { eventTitle: "Fire Night" }, lengthSec: 15 });
  assert.equal(s.source, "template");
  assert.equal(s.title, "Fire Night");
});

test("a too-long AI title falls back to the template title", async () => {
  _setLlmImpl(async () => json({ title: "T".repeat(41), statements: ["One"] }));
  const s = await suggestStatements({ occasion: "birthday", details: { name: "Ada" }, lengthSec: 15 });
  assert.equal(s.title, "Happy birthday, Ada!");
  assert.deepEqual(s.statements, ["One"]);
});

test("church occasions get the verse text from the lookup, never from the LLM", async () => {
  _setLlmImpl(async () => json({ title: "Fire Night", statements: ["Come"], verseReference: "Jn 3:16", verseText: "MADE UP WORDS" }));
  let asked = null;
  _setLookupImpl(async (ref, tr) => { asked = [ref, tr]; return { ok: true, canonical: "John 3:16", verses: [{ text: "For God so loved the world" }] }; });
  const s = await suggestStatements({ occasion: "sermon", details: {}, lengthSec: 30 });
  assert.deepEqual(asked, ["John 3:16", "kjv"]);
  assert.deepEqual(s.verse, { reference: "John 3:16", text: "For God so loved the world" });
});

test("an invalid reference or a failed lookup drops the verse", async () => {
  _setLlmImpl(async () => json({ title: "T", statements: ["A"], verseReference: "Hezekiah 9:99" }));
  _setLookupImpl(async () => { throw new Error("should not be called"); });
  assert.equal((await suggestStatements({ occasion: "sermon", details: {}, lengthSec: 15 })).verse, undefined);
  _setLlmImpl(async () => json({ title: "T", statements: ["A"], verseReference: "John 3:16" }));
  _setLookupImpl(async () => { throw new Error("offline"); });
  assert.equal((await suggestStatements({ occasion: "sermon", details: {}, lengthSec: 15 })).verse, undefined);
});

test("a chapter-only reference never looks a verse up", async () => {
  let called = false;
  _setLlmImpl(async () => json({ title: "T", statements: ["A"], verseReference: "Psalm 119" }));
  _setLookupImpl(async () => { called = true; throw new Error("should not be called"); });
  const s = await suggestStatements({ occasion: "sermon", details: {}, lengthSec: 15 });
  assert.equal(s.source, "ai");
  assert.equal(s.verse, undefined);
  assert.equal(called, false);
});

test("a range longer than four verses never looks a verse up", async () => {
  let called = false;
  _setLlmImpl(async () => json({ title: "T", statements: ["A"], verseReference: "John 3:16-20" }));
  _setLookupImpl(async () => { called = true; throw new Error("should not be called"); });
  const s = await suggestStatements({ occasion: "sermon", details: {}, lengthSec: 15 });
  assert.equal(s.source, "ai");
  assert.equal(s.verse, undefined);
  assert.equal(called, false);
});

test("a four-verse range (John 3:16-19) still looks up", async () => {
  _setLlmImpl(async () => json({ title: "T", statements: ["A"], verseReference: "John 3:16-19" }));
  let asked = null;
  _setLookupImpl(async (ref) => { asked = ref; return { ok: true, canonical: "John 3:16-19", verses: [{ text: "For God so loved" }] }; });
  const s = await suggestStatements({ occasion: "sermon", details: {}, lengthSec: 15 });
  assert.equal(asked, "John 3:16-19");
  assert.deepEqual(s.verse, { reference: "John 3:16-19", text: "For God so loved" });
});
