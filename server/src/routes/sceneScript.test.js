import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import express from "express";
import request from "supertest";
import { createSceneScriptRouter } from "./sceneScript.js";
import { createVisualLibraryRouter } from "./visualLibrary.js";
import { requireSuperAdmin } from "../middleware/requireSuperAdmin.js";
import { addClip } from "../lib/visualLibrary/store.js";
import { isVoicing } from "../lib/sceneScript/voiceStage.js";
import { isOrderingShots } from "../lib/sceneScript/shotStage.js";

const SCRIPT = [
  "TITLE: Be Still | Psalm 46:10",
  "### Scene 1 — Opening (0:00–0:06)",
  "*Visual: A man standing alone by a river at dawn.*",
  "**Narrator (calm):**",
  "\"Be still.\"",
  "### Scene 2 — Answer (0:06–0:12)",
  "*Visual: A golden sunrise over the hills.*",
  "**Narrator:**",
  "\"And know that I am God.\"",
].join("\n");

const voiceDeps = {
  sleep: async () => {},
  synth: async () => ({ audio: Buffer.from("RIFF"), boundaries: [] }),
  ffmpeg: async (args) => { fs.writeFileSync(args.at(-1), "wav"); return { ok: true }; },
  probe: async () => 2,
};
const shotDeps = {
  submit: async () => ({ ok: true, taskId: `t-${Math.random()}` }),
  wait: async () => ({ ok: true, videoUrl: "https://example.com/x.mp4", tokens: 100000 }),
  download: async (_u, f) => fs.writeFileSync(f, "mp4"),
  ffmpeg: async (args) => { fs.writeFileSync(args.at(-1), "jpg"); return { ok: true }; },
  probe: async () => 6,
};

async function until(fn) {
  for (let i = 0; i < 400 && fn(); i += 1) await new Promise((r) => setTimeout(r, 5));
}

describe("/api/scene-script", () => {
  let root;
  let app;
  let admin = true;
  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ss-routes-"));
    process.env.BYTEPLUS_ARK_API_KEY = "test-key";
    process.env.AZURE_SPEECH_KEY = "k";
    process.env.AZURE_SPEECH_REGION = "uksouth";
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = "100";
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.ctx = { dataDir: path.join(root, "data"), outputDir: path.join(root, "out"), isSuperAdmin: admin };
      next();
    });
    const deps = { voice: voiceDeps, shots: shotDeps, llm: async () => '[{"id":"sh1","prompt":"A calm river at dawn."}]' };
    app.use("/api/scene-script", requireSuperAdmin, createSceneScriptRouter({ ledgerDir: path.join(root, "ledger"), deps }));
    app.use("/api/visual-library", requireSuperAdmin, createVisualLibraryRouter());
  });
  after(() => {
    for (const k of ["BYTEPLUS_ARK_API_KEY", "AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION", "VIDEO_GEN_MONTHLY_CAP_USD"]) delete process.env[k];
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("refuses anyone who is not a super admin", async () => {
    admin = false;
    const r = await request(app).post("/api/scene-script/parse").send({ markdown: SCRIPT });
    admin = true;
    assert.equal(r.status, 403);
  });

  test("parses without saving and shows the estimate", async () => {
    const r = await request(app).post("/api/scene-script/parse").send({ markdown: SCRIPT });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.preview.lines.map((l) => l.text), ["Be still.", "And know that I am God."]);
    assert.equal(r.body.estimate.clips, r.body.preview.shots.length);
    const list = await request(app).get("/api/scene-script");
    assert.equal(list.body.projects.length, 0);
  });

  test("rejects an empty or oversized script", async () => {
    assert.equal((await request(app).post("/api/scene-script/parse").send({ markdown: " " })).status, 400);
    assert.equal((await request(app).post("/api/scene-script/parse").send({ markdown: "x".repeat(40_001) })).status, 413);
  });

  test("runs the whole flow: create, edit, voice, suggest, order, reuse, render guard, delete", async () => {
    const created = await request(app).post("/api/scene-script").send({ markdown: SCRIPT });
    assert.equal(created.status, 201);
    const id = created.body.project.id;
    assert.equal(created.body.project.source.markdown, undefined, "the pasted text is not echoed back");

    const edited = await request(app).patch(`/api/scene-script/${id}`).send({
      cast: { Narrator: { voice: "en-NG-AbeoNeural" } },
      lines: [{ id: "l2", text: "And know that I am God!", gapAfter: 1.5 }],
      cues: [{ id: "m1", bed: "library:prayer-piano" }, { id: "m2", bed: "../../etc/passwd" }],
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.project.cast.Narrator.voice, "en-NG-AbeoNeural");
    assert.equal(edited.body.project.lines[1].text, "And know that I am God!");
    assert.equal(edited.body.project.music.cues[0].bed, "library:prayer-piano");
    assert.notEqual(edited.body.project.music.cues[1].bed, "../../etc/passwd");
    assert.equal(edited.body.project.needsVoice, true);

    const notReady = await request(app).post(`/api/scene-script/${id}/render`);
    assert.equal(notReady.status, 409);
    assert.equal(notReady.body.code, "NOT_READY");

    assert.equal((await request(app).post(`/api/scene-script/${id}/voice`)).status, 200);
    await until(() => isVoicing(id));
    const voiced = await request(app).get(`/api/scene-script/${id}`);
    assert.equal(voiced.body.project.voice.status, "done");
    assert.equal(voiced.body.project.needsVoice, false);
    assert.equal(voiced.body.project.lines[1].gapAfter, 1.5);

    const retake = await request(app).patch(`/api/scene-script/${id}`).send({ lines: [{ id: "l1", retake: true }] });
    assert.equal(retake.body.project.lines[0].audio, null);
    assert.equal(retake.body.project.needsVoice, true);
    await request(app).post(`/api/scene-script/${id}/voice`);
    await until(() => isVoicing(id));

    const suggested = await request(app).post(`/api/scene-script/${id}/suggest-shots`).send({});
    assert.equal(suggested.status, 200);
    assert.match(suggested.body.project.shots[0].effectivePrompt, /^A calm river at dawn\./);
    assert.equal(suggested.body.project.shots[0].suggested, true);

    const src = path.join(root, "lib.mp4");
    fs.writeFileSync(src, "mp4");
    const clip = addClip({ dataDir: path.join(root, "data"), outputDir: path.join(root, "out") }, { file: src, prompt: "sunrise" });
    const reused = await request(app).post(`/api/scene-script/${id}/shots/sh2/library`).send({ clipId: clip.id });
    assert.equal(reused.status, 200);
    assert.equal(reused.body.project.shots[1].clip.fromLibrary, true);

    const ordered = await request(app).post(`/api/scene-script/${id}/shots`).send({});
    assert.equal(ordered.status, 200);
    await until(() => isOrderingShots(id));
    const shot = (await request(app).get(`/api/scene-script/${id}`)).body.project;
    assert.ok(shot.shots.every((s) => s.clip?.status === "done"));
    assert.equal((await request(app).post(`/api/scene-script/${id}/shots`).send({})).body.code, "NOTHING_TO_ORDER");

    const inUse = await request(app).delete(`/api/visual-library/${clip.id}`);
    assert.equal(inUse.status, 409);
    assert.equal(inUse.body.code, "IN_USE");

    assert.equal((await request(app).delete(`/api/scene-script/${id}`)).status, 200);
    assert.equal((await request(app).get(`/api/scene-script/${id}`)).status, 404);
  });

  test("asks for confirmation above the $10 benchmark", async () => {
    process.env.SCENE_SCRIPT_BENCHMARK_USD = "0.01";
    try {
      const id = (await request(app).post("/api/scene-script").send({ markdown: SCRIPT })).body.project.id;
      const r = await request(app).post(`/api/scene-script/${id}/shots`).send({});
      assert.equal(r.status, 409);
      assert.equal(r.body.code, "OVER_BENCHMARK");
      assert.ok(r.body.estimate.totalUsd > 0.01);
      const ok = await request(app).post(`/api/scene-script/${id}/shots`).send({ confirmOverBenchmark: true });
      assert.equal(ok.status, 200);
      await until(() => isOrderingShots(id));
    } finally {
      delete process.env.SCENE_SCRIPT_BENCHMARK_USD;
    }
  });

  test("answers 404 for an id that is not a project id", async () => {
    assert.equal((await request(app).get("/api/scene-script/..%2F..%2Fsecrets")).status, 404);
    assert.equal((await request(app).get("/api/scene-script/not-a-uuid")).status, 404);
  });

  test("lists the voices the cast pickers offer", async () => {
    const r = await request(app).get("/api/scene-script/voices");
    assert.ok(r.body.voices.some((v) => v.id === "en-NG-AbeoNeural"));
  });
});
