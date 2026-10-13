// server/src/lib/lyricVideo/whisperPrompted.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { transcribePrompted } from "./whisperPrompted.js";

test("sends the prompt and word timestamps, returns words", async () => {
  const f = path.join(os.tmpdir(), "wp-test.m4a");
  fs.writeFileSync(f, "x");
  let sent;
  const fetchImpl = async (url, opts) => {
    sent = opts.body;
    return { ok: true, json: async () => ({ words: [{ word: "Eh", start: 0, end: 0.4 }] }) };
  };
  const out = await transcribePrompted(f, "Eh-yeah", { fetchImpl, apiKey: "k" });
  assert.deepEqual(out.words, [{ word: "Eh", start: 0, end: 0.4 }]);
  assert.equal(sent.get("prompt"), "Eh-yeah");
  assert.equal(sent.get("language"), "en");
  assert.equal(sent.get("temperature"), "0");
  assert.equal(sent.getAll("timestamp_granularities[]")[0], "word");
});

test("an HTTP error throws with the status", async () => {
  const f = path.join(os.tmpdir(), "wp-test.m4a");
  fs.writeFileSync(f, "x");
  const fetchImpl = async () => ({ ok: false, status: 429, text: async () => "rate limited" });
  await assert.rejects(transcribePrompted(f, "x", { fetchImpl, apiKey: "k" }), /429/);
});

test("no API key throws a clear error", async () => {
  await assert.rejects(transcribePrompted("x.m4a", "x", { apiKey: "" }), /OPENAI_API_KEY/);
});
