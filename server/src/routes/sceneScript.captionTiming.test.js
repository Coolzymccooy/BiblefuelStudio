import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { createSceneScriptRouter } from "./sceneScript.js";
import { requireSuperAdmin } from "../middleware/requireSuperAdmin.js";
import { projectFromMarkdown } from "../lib/sceneScript/model.js";
import { createProject, readProject, updateProject } from "../lib/sceneScript/projectStore.js";
import { withTimeline, lineAudioKey } from "../lib/sceneScript/voiceStage.js";
import { isRendering } from "../lib/sceneScript/renderStage.js";

const SCRIPT = 'TITLE: Timing\n### Scene 1 — Test (0:00–0:06)\n*Visual: River.*\n**Narrator:**\n"Be still."';
const valid = [{ text: "Be", start: 0, end: 0.4 }, { text: "still.", start: 0.4, end: 0.8 }];

test("HTTP caption preflight refuses before queue/assets/render; explicit captionless and legacy valid renders finish", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ss-caption-http-"));
  const ctx = { dataDir: path.join(root, "data"), outputDir: path.join(root, "out"), isSuperAdmin: true };
  const calls = [];
  const deps = {
    serveUrl: async () => { calls.push("bundle"); return "http://bundle.invalid"; },
    render: async ({ inputProps, outputLocation }) => { calls.push(inputProps); fs.writeFileSync(outputLocation, "synthetic"); },
    probe: async () => 2,
    ffmpeg: async (args) => { calls.push("ffmpeg"); if (args.at(-1) !== "-") fs.writeFileSync(args.at(-1), "synthetic"); return { ok: true, stderr: "" }; },
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.ctx = ctx; next(); });
  app.use("/api/scene-script", requireSuperAdmin, createSceneScriptRouter({ ledgerDir: path.join(root, "ledger"), deps: { render: deps } }));
  try {
    const raw = projectFromMarkdown(SCRIPT);
    const p = createProject(ctx.dataDir, withTimeline({ ...raw, shots: [], music: { cues: [] }, voice: { status: "done" }, lines: raw.lines.map((line) => ({ ...line, audio: { key: lineAudioKey(line, raw.cast), file: "synthetic.wav", durationSec: 1, words: valid } })) }));
    const url = `/api/scene-script/${p.id}`;
    for (const [words, timing, reason] of [
      [valid, { quality: "unresolved" }, "UNRESOLVED_TIMING"],
      [undefined, undefined, "MISSING_WORD_TIMING"],
      [[], undefined, "MISSING_WORD_TIMING"],
      [[{ text: "Be", start: 0, end: 0 }], undefined, "INVALID_WORD_SPAN"],
      [[{ text: "Be", start: 1, end: 0 }], undefined, "INVALID_WORD_SPAN"],
      [[{ text: "Be", start: null, end: 1 }], undefined, "INVALID_WORD_SPAN"],
      [[{ text: "Be", start: "0", end: 1 }], undefined, "INVALID_WORD_SPAN"],
    ]) {
      updateProject(ctx.dataDir, p.id, (x) => ({ ...x, lines: x.lines.map((l) => ({ ...l, audio: { ...l.audio, words, timing } })) }));
      const before = readProject(ctx.dataDir, p.id);
      // A request-body flag is not the persisted captions setting.
      const r = await request(app).post(`${url}/render`).send({ captions: { enabled: false } });
      assert.equal(r.status, 409, JSON.stringify(r.body));
      assert.equal(r.body.code, "CAPTION_TIMING_UNRESOLVED");
      assert.equal(r.body.lines[0].lineId, p.lines[0].id);
      assert.ok(r.body.lines[0].reasons.includes(reason));
      assert.match(r.body.error, /Re-record.*captions.enabled: false/);
      assert.deepEqual(readProject(ctx.dataDir, p.id), before);
      assert.equal(isRendering(p.id), false);
      assert.deepEqual(calls, []);
      assert.equal(fs.existsSync(ctx.outputDir), false);
      assert.equal(fs.existsSync(path.join(root, "ledger")), false);
    }
    // Exact omissions, reorder and same-count replacement cannot borrow spans.
    for (const texts of [["still", "saves"], ["Grace", "saves"], ["Grace", "still"], ["saves", "still", "Grace"], ["Grace", "now", "saves"], ["Grace"]]) {
      updateProject(ctx.dataDir, p.id, (x) => ({ ...x, lines: x.lines.map((l) => ({ ...l, text: texts.length === 1 ? "Grace saves" : "Grace still saves", audio: { ...l.audio, words: texts.map((text, i) => ({ text, start: i / 4, end: (i + 1) / 4 })), timing: { quality: "native" } } })) }));
      updateProject(ctx.dataDir, p.id, (x) => ({ ...x, lines: x.lines.map((l) => ({ ...l, audio: { ...l.audio, key: lineAudioKey(l, x.cast) } })) }));
      const before = readProject(ctx.dataDir, p.id);
      const r = await request(app).post(`${url}/render`);
      assert.equal(r.status, 409, JSON.stringify(r.body));
      assert.ok(r.body.lines[0].reasons.includes("WORD_COVERAGE_MISMATCH"));
      assert.deepEqual(readProject(ctx.dataDir, p.id), before);
      assert.equal(isRendering(p.id), false);
      assert.deepEqual(calls, []);
      assert.equal(fs.existsSync(path.join(root, "ledger")), false);
    }
    // User-approved captionless render preserves bad timing but does not caption it.
    assert.equal((await request(app).patch(url).send({ captions: { enabled: false } })).status, 200);
    const run = async () => {
      assert.equal((await request(app).post(`${url}/render`)).status, 200);
      for (let i = 0; i < 400 && isRendering(p.id); i++) await new Promise((r) => setTimeout(r, 5));
      assert.equal(isRendering(p.id), false);
      assert.equal(readProject(ctx.dataDir, p.id).render.status, "done");
    };
    await run();
    assert.equal(calls.find((x) => typeof x === "object").captions, false);
    calls.length = 0;
    // Old projects have no provenance or captions object: renderer defaults on.
    updateProject(ctx.dataDir, p.id, (x) => ({ ...x, captions: undefined, lines: x.lines.map((l) => ({ ...l, text: "BE, still!", audio: { ...l.audio, words: valid, timing: undefined } })) }));
    updateProject(ctx.dataDir, p.id, (x) => ({ ...x, lines: x.lines.map((l) => ({ ...l, audio: { ...l.audio, key: lineAudioKey(l, x.cast) } })) }));
    await run();
    assert.equal(calls.find((x) => typeof x === "object").captions, true);
    // These modes render the full line, not word-by-word captions.
    for (const kind of ["chant", "reference"]) {
      updateProject(ctx.dataDir, p.id, (x) => ({ ...x, lines: x.lines.map((l) => ({ ...l, kind, audio: { ...l.audio, words: [], timing: { quality: "unresolved" } } })) }));
      updateProject(ctx.dataDir, p.id, (x) => ({ ...x, lines: x.lines.map((l) => ({ ...l, audio: { ...l.audio, key: lineAudioKey(l, x.cast) } })) }));
      await run();
    }
    // A punctuation placeholder explicitly marked nonspoken is not missing speech.
    updateProject(ctx.dataDir, p.id, (x) => ({ ...x, lines: x.lines.map((l) => ({ ...l, kind: "narration", text: "Grace — saves", audio: { ...l.audio, words: [{ text: "Grace", start: 0, end: 0.4 }, { text: "—", start: 0.4, end: 0.4 }, { text: "saves", start: 0.4, end: 0.8 }], timing: { quality: "native", tokens: [{ index: 1, text: "—", provenance: "nonspoken" }] } } })) }));
    // Changing the authored text requires refreshing the synthetic audio key.
    updateProject(ctx.dataDir, p.id, (x) => ({ ...x, lines: x.lines.map((l) => ({ ...l, audio: { ...l.audio, key: lineAudioKey(l, x.cast) } })) }));
    await run();
    updateProject(ctx.dataDir, p.id, (x) => ({ ...x, lines: x.lines.map((l) => ({ ...l, audio: { ...l.audio, words: l.audio.words.map((w, i) => i === 2 ? { ...w, end: w.start } : w) } })) }));
    const missingLexical = await request(app).post(`${url}/render`);
    assert.equal(missingLexical.status, 409);
    assert.deepEqual(missingLexical.body.lines[0].wordIndexes, [2]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
