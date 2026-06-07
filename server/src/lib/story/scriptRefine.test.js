import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { refineScript, _setLlmImpl, _resetLlmImpl } from "./scriptRefine.js";
import { templateById } from "./scriptTemplates.js";

afterEach(() => _resetLlmImpl());

describe("refineScript", () => {
  test("returns the LLM's narration, trimmed of quotes/markdown", async () => {
    _setLlmImpl(async () => '"When life feels heavy, God is near."');
    const out = await refineScript({ idea: "god is near in hard times", template: templateById("devotional-30") });
    assert.equal(out, "When life feels heavy, God is near.");
  });
  test("includes the template prompt and a word target in the LLM prompt", async () => {
    let seen = "";
    _setLlmImpl(async (p) => { seen = p; return "ok"; });
    await refineScript({ idea: "trust", template: templateById("teaching-60") });
    assert.match(seen, /clear, simple Bible teaching/i);
    assert.match(seen, /\b\d{2,3}\b/);
    assert.match(seen, /trust/);
  });
  test("falls back to the raw idea when the LLM throws", async () => {
    _setLlmImpl(async () => { throw new Error("down"); });
    const out = await refineScript({ idea: "  keep going  ", template: templateById("custom") });
    assert.equal(out, "keep going");
  });
  test("falls back to the raw idea when the LLM returns empty", async () => {
    _setLlmImpl(async () => "   ");
    const out = await refineScript({ idea: "hold on", template: templateById("custom") });
    assert.equal(out, "hold on");
  });
});
