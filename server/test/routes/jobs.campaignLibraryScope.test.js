/**
 * A campaign_auto_post job picks its background from the caller's library at
 * RUN time, past the enqueue payload check (#112, security review). A planted
 * library item linking another tenant's file must fail the job with
 * PATH_OUTSIDE_MEDIA, and ffmpeg must never open that file.
 *
 * TTS comes from a stub Chatterbox bridge that answers a real tone, so the
 * campaign gets as far as choosing a background.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "campaign-scope-"));
process.env.DATA_DIR = path.join(root, "data");
process.env.OUTPUT_DIR = path.join(root, "outputs");
fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
fs.mkdirSync(process.env.OUTPUT_DIR, { recursive: true });
process.env.EDGE_TTS_ENABLED = "false";
for (const k of ["ELEVENLABS_API_KEY", "AZURE_SPEECH_KEY", "FISH_API_KEY", "PIPER_URL", "CHATTERBOX_AUDIO_PROMPT"]) delete process.env[k];

const FF = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const noFfmpeg = spawnSync(FF, ["-version"]).status !== 0 && "ffmpeg not installed";

const jobs = await import("../../src/routes/jobs.js");
const { captureFfmpegReports } = await import("../helpers/ffreport.js");

const userDir = path.join(process.env.DATA_DIR, "users", "me");
const mine = path.join(userDir, "outputs");
const theirs = path.join(process.env.DATA_DIR, "users", "them", "outputs");
const ctx = { userId: "me", dataDir: userDir, outputDir: mine, isSuperAdmin: false, isOwner: false };
const secret = path.join(theirs, "private.mp4");
let bridge;

before(async () => {
  fs.mkdirSync(mine, { recursive: true });
  fs.mkdirSync(theirs, { recursive: true });
  fs.writeFileSync(secret, "x");
  fs.writeFileSync(path.join(userDir, "library.json"), JSON.stringify({ items: [
    { id: "evil", files: [{ link: secret, quality: "hd", width: 1 }], tags: ["peace"] },
  ] }));
  const tone = path.join(root, "tone.mp3");
  if (!noFfmpeg) spawnSync(FF, ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=f=440:d=2", tone]);
  bridge = http.createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    res.writeHead(200, { "content-type": "audio/mpeg" }).end(fs.readFileSync(tone));
  });
  await new Promise((resolve) => bridge.listen(0, "127.0.0.1", resolve));
  process.env.CHATTERBOX_URL = `http://127.0.0.1:${bridge.address().port}`;
});

after(async () => {
  bridge.closeAllConnections();
  await new Promise((resolve) => bridge.close(resolve));
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});

test("a campaign picking a planted library item fails with PATH_OUTSIDE_MEDIA and never reads it", { skip: noFfmpeg }, async () => {
  const cap = captureFfmpegReports(path.join(root, "reports"));
  jobs._setJobCtxForTest(ctx);
  try {
    await assert.rejects(() => jobs._executeJobForTest({
      id: "job_campaign", type: "campaign_auto_post",
      payload: {
        destination: "none",
        prebuiltScript: { hook: "Peace be with you", verse: "The Lord is my shepherd", reference: "Psalm 23:1", reflection: "Rest in him", cta: "Share this" },
      },
    }), /PATH_OUTSIDE_MEDIA/);
  } finally {
    jobs._resetJobCtxForTest();
    cap.stop();
  }
  const readSecret = cap.commands().filter((c) => c.tokens.some((t) => path.resolve(t) === path.resolve(secret)));
  assert.deepEqual(readSecret, []);
});

test("a campaign never picks a library item whose id is a path", { skip: noFfmpeg }, async () => {
  fs.writeFileSync(path.join(userDir, "library.json"), JSON.stringify({ items: [{ id: secret, tags: ["peace"] }] }));
  const cap = captureFfmpegReports(path.join(root, "reports-pathid"));
  jobs._setJobCtxForTest(ctx);
  try {
    await assert.rejects(() => jobs._executeJobForTest({
      id: "job_campaign_pathid", type: "campaign_auto_post",
      payload: {
        destination: "none",
        prebuiltScript: { hook: "Peace be with you", verse: "The Lord is my shepherd", reference: "Psalm 23:1", reflection: "Rest in him", cta: "Share this" },
      },
    }), /library is empty/);
  } finally {
    jobs._resetJobCtxForTest();
    cap.stop();
  }
  const readSecret = cap.commands().filter((c) => c.tokens.some((t) => path.resolve(t) === path.resolve(secret)));
  assert.deepEqual(readSecret, []);
});
