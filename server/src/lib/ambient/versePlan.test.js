import test from "node:test";
import assert from "node:assert/strict";
import {
  planReferences, suggestReferences, FALLBACK_REFERENCES,
  _setLlmImpl, _resetLlmImpl,
} from "./versePlan.js";

test("suggestReferences returns canonical references from a clean model answer", async () => {
  _setLlmImpl(async () => "Psalm 23:1-3\nJohn 14:27\nIsaiah 40:31");
  const refs = await suggestReferences({ theme: "rest", count: 3 });
  assert.deepEqual(refs, ["Psalms 23:1-3", "John 14:27", "Isaiah 40:31"]);
  _resetLlmImpl();
});

test("list markers and trailing commentary are stripped", async () => {
  _setLlmImpl(async () => "1. Psalm 4:8 — a verse about sleep\n- John 14:27 (peace)\n* Isaiah 26:3");
  const refs = await suggestReferences({ theme: "rest", count: 3 });
  assert.deepEqual(refs, ["Psalms 4:8", "John 14:27", "Isaiah 26:3"]);
  _resetLlmImpl();
});

test("a fabricated reference is discarded, not passed to lookup", async () => {
  // Psalm has 150 chapters; 200 is a hallucination that would fetch nothing.
  _setLlmImpl(async () => "Psalm 200:4\nHezekiah 3:1\nPsalm 46:10");
  const refs = await suggestReferences({ theme: "stillness", count: 3 });
  assert.deepEqual(refs, ["Psalms 46:10"]);
  _resetLlmImpl();
});

test("duplicate suggestions are collapsed", async () => {
  _setLlmImpl(async () => "Psalm 46:10\npsalm 46:10\nPsalm 4:8");
  const refs = await suggestReferences({ theme: "rest", count: 3 });
  assert.deepEqual(refs, ["Psalms 46:10", "Psalms 4:8"]);
  _resetLlmImpl();
});

test("no theme means no model call at all", async () => {
  let called = false;
  _setLlmImpl(async () => { called = true; return "Psalm 23:1"; });
  assert.deepEqual(await suggestReferences({ theme: "  ", count: 3 }), []);
  assert.equal(called, false);
  _resetLlmImpl();
});

test("planReferences falls back to the curated list when no model is configured", async () => {
  _setLlmImpl(async () => "");
  const refs = await planReferences({ theme: "still waters", count: 4 });
  assert.deepEqual(refs, FALLBACK_REFERENCES.slice(0, 4));
  _resetLlmImpl();
});

test("a throwing model is not fatal — the session still gets its verses", async () => {
  _setLlmImpl(async () => { throw new Error("429 rate limited"); });
  const refs = await planReferences({ theme: "rest", count: 3 });
  assert.equal(refs.length, 3);
  refs.forEach((r) => assert.ok(FALLBACK_REFERENCES.includes(r)));
  _resetLlmImpl();
});

test("a short model answer is topped up to the requested count", async () => {
  _setLlmImpl(async () => "Psalm 131:2");
  const refs = await planReferences({ theme: "quiet", count: 4 });
  assert.equal(refs.length, 4);
  assert.equal(refs[0], "Psalms 131:2");
  _resetLlmImpl();
});

test("asking for more drops than the curated list holds still returns that many", async () => {
  _setLlmImpl(async () => "");
  const n = FALLBACK_REFERENCES.length + 3;
  const refs = await planReferences({ theme: "rest", count: n });
  assert.equal(refs.length, n);
  _resetLlmImpl();
});

test("count 0 returns nothing", async () => {
  assert.deepEqual(await planReferences({ theme: "rest", count: 0 }), []);
});

test("every curated reference parses — a typo here would break the fallback", async () => {
  const { normalizeReference } = await import("../bible/bibleReference.js");
  for (const ref of FALLBACK_REFERENCES) {
    assert.ok(normalizeReference(ref), `unparseable fallback reference: ${ref}`);
  }
});
