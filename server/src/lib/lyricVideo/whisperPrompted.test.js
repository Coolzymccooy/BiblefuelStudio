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

test("drops words whose times are not numbers", async () => {
  const f = path.join(os.tmpdir(), "wp-test.m4a");
  fs.writeFileSync(f, "x");
  const words = [
    { word: "Eh", start: 0, end: 0.4 },
    { word: "yeah", start: "soon", end: 0.9 },
    { word: "eh", start: 1, end: null },
    { word: "yeah", start: 1.2 },
    { word: "Dem", start: 1.5, end: 1.8 },
  ];
  const fetchImpl = async () => ({ ok: true, json: async () => ({ words }) });
  const out = await transcribePrompted(f, "x", { fetchImpl, apiKey: "k" });
  assert.deepEqual(out.words, [{ word: "Eh", start: 0, end: 0.4 }, { word: "Dem", start: 1.5, end: 1.8 }]);
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

test("the upload is typed by the file's extension", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wp-mime-"));
  try {
    const types = {};
    const fetchImpl = async (url, opts) => { types.last = opts.body.get("file").type; return { ok: true, json: async () => ({ words: [] }) }; };
    for (const [name, want] of [["a.wav", "audio/wav"], ["a.m4a", "audio/mp4"], ["a.mp4", "audio/mp4"], ["a.mp3", "audio/mpeg"], ["a.webm", "audio/webm"], ["a.bin", "audio/mp4"]]) {
      const f = path.join(dir, name);
      fs.writeFileSync(f, "x");
      await transcribePrompted(f, "x", { fetchImpl, apiKey: "k" });
      assert.equal(types.last, want, name);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
