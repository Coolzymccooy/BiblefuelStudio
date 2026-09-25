import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import { Readable } from "stream";
import socialRouter, { _setFetchImpl, _resetFetchImpl, _resetPublishJobs } from "./social.js";
import { _setGoogleImpl, _resetGoogleImpl } from "../lib/social/youtubeUpload.js";
import { writeSocialStore } from "../lib/socialStore.js";
import { createProject, readProject, writeProject } from "../lib/ambient/projectStore.js";

// A long video took longer than the browser's 15 s wait: the page showed an
// error while the upload carried on, a retry uploaded a second copy, and the
// ambient session never recorded that it was published. Publishing is now a
// job the page checks on.

function app({ userId = "u1", dataDir: shared } = {}) {
  const dataDir = shared || fs.mkdtempSync(path.join(os.tmpdir(), "yt-job-"));
  const outputDir = path.join(dataDir, "outputs");
  fs.mkdirSync(outputDir, { recursive: true });
  writeSocialStore(dataDir, { direct: { youtube: { clientId: "id", clientSecret: "sec", refreshToken: "ref" } } });
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.ctx = { userId, dataDir, outputDir, isSuperAdmin: false }; next(); });
  a.use("/api/social", socialRouter);
  return { a, dataDir, outputDir };
}

/** A Google fake whose insert waits until `release()` is called. */
function gatedGoogle({ fail = null } = {}) {
  const calls = { insert: 0 };
  let release;
  const gate = new Promise((r) => { release = r; });
  class OAuth2 { setCredentials() {} }
  return {
    calls,
    release: () => release(),
    google: {
      auth: { OAuth2 },
      youtube: () => ({
        videos: {
          insert: async (args) => {
            calls.insert += 1;
            const body = args?.media?.body;
            if (body && typeof body[Symbol.asyncIterator] === "function") {
              for await (const _chunk of body) { /* drain like the real client */ }
            }
            await gate;
            if (fail) throw new Error(fail);
            return { data: { id: "vidJob1" } };
          },
        },
        thumbnails: { set: async () => ({ data: {} }) },
      }),
    },
  };
}

async function waitForJob(a, jobId, ms = 3000) {
  const start = Date.now();
  for (;;) {
    const res = await request(a).get(`/api/social/youtube/publish/${jobId}`);
    if (res.body?.job && res.body.job.status !== "running") return res.body.job;
    if (Date.now() - start > ms) throw new Error(`job still running: ${JSON.stringify(res.body)}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("POST /api/social/youtube/publish", () => {
  let fake;
  beforeEach(() => { _resetPublishJobs(); });
  afterEach(() => { _resetGoogleImpl(); _resetFetchImpl(); _resetPublishJobs(); });

  test("answers at once with a job, and the upload finishes in the background", async () => {
    fake = gatedGoogle();
    _setGoogleImpl(fake.google);
    const { a, outputDir } = app();
    fs.writeFileSync(path.join(outputDir, "long.mp4"), "vid");
    const res = await request(a).post("/api/social/youtube/publish").send({
      videoUrl: "/outputs/long.mp4", title: "Still Waters", privacyStatus: "private",
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.jobId);
    const running = await request(a).get(`/api/social/youtube/publish/${res.body.jobId}`);
    assert.equal(running.body.job.status, "running");

    fake.release();
    const job = await waitForJob(a, res.body.jobId);
    assert.equal(job.status, "done");
    assert.equal(job.result.videoId, "vidJob1");
  });

  test("a second click on the same video while it uploads joins that upload, never a second copy", async () => {
    fake = gatedGoogle();
    _setGoogleImpl(fake.google);
    const { a, outputDir } = app();
    fs.writeFileSync(path.join(outputDir, "long.mp4"), "vid");
    const body = { videoUrl: "/outputs/long.mp4", title: "Still Waters" };
    const first = await request(a).post("/api/social/youtube/publish").send(body);
    const second = await request(a).post("/api/social/youtube/publish").send(body);
    assert.equal(second.body.jobId, first.body.jobId);
    fake.release();
    await waitForJob(a, first.body.jobId);
    assert.equal(fake.calls.insert, 1);
  });

  test("once it has finished, publishing again is a new upload (the operator asked for it)", async () => {
    fake = gatedGoogle();
    _setGoogleImpl(fake.google);
    fake.release();
    const { a, outputDir } = app();
    fs.writeFileSync(path.join(outputDir, "long.mp4"), "vid");
    const body = { videoUrl: "/outputs/long.mp4", title: "Still Waters" };
    const first = await request(a).post("/api/social/youtube/publish").send(body);
    await waitForJob(a, first.body.jobId);
    const again = await request(a).post("/api/social/youtube/publish").send(body);
    assert.notEqual(again.body.jobId, first.body.jobId);
    await waitForJob(a, again.body.jobId);
    assert.equal(fake.calls.insert, 2);
  });

  test("what can be checked at once is refused at once, with no job", async () => {
    fake = gatedGoogle();
    _setGoogleImpl(fake.google);
    const { a } = app();
    const noTitle = await request(a).post("/api/social/youtube/publish").send({ videoUrl: "/outputs/x.mp4", title: "" });
    assert.equal(noTitle.status, 400);
    const noVideo = await request(a).post("/api/social/youtube/publish").send({ title: "T" });
    assert.equal(noVideo.status, 400);
    assert.equal(fake.calls.insert, 0);
  });

  test("a failed upload is reported on the job", async () => {
    fake = gatedGoogle({ fail: "quotaExceeded" });
    _setGoogleImpl(fake.google);
    fake.release();
    const { a, outputDir } = app();
    fs.writeFileSync(path.join(outputDir, "long.mp4"), "vid");
    const res = await request(a).post("/api/social/youtube/publish").send({ videoUrl: "/outputs/long.mp4", title: "T" });
    const job = await waitForJob(a, res.body.jobId);
    assert.equal(job.status, "error");
    assert.match(job.error, /quotaExceeded/);
  });

  test("another account can't see your job", async () => {
    fake = gatedGoogle();
    _setGoogleImpl(fake.google);
    fake.release();
    const mine = app({ userId: "u1" });
    fs.writeFileSync(path.join(mine.outputDir, "long.mp4"), "vid");
    const res = await request(mine.a).post("/api/social/youtube/publish").send({ videoUrl: "/outputs/long.mp4", title: "T" });
    const theirs = app({ userId: "u2" });
    const peek = await request(theirs.a).get(`/api/social/youtube/publish/${res.body.jobId}`);
    assert.equal(peek.status, 404);
  });

  test("an ambient session records its video itself, even if the page was closed", async () => {
    fake = gatedGoogle();
    _setGoogleImpl(fake.google);
    const { a, dataDir, outputDir } = app();
    fs.writeFileSync(path.join(outputDir, "long.mp4"), "vid");
    const project = createProject(dataDir, { title: "Rest", theme: "rest", targetSec: 600 });
    writeProject(dataDir, { ...project, status: "done" });
    const res = await request(a).post("/api/social/youtube/publish").send({
      videoUrl: "/outputs/long.mp4", title: "Rest", privacyStatus: "unlisted",
      record: { ambientProjectId: project.projectId },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    fake.release();
    const job = await waitForJob(a, res.body.jobId);
    assert.equal(job.result.recorded, true);
    const published = readProject(dataDir, project.projectId).published;
    assert.equal(published.length, 1);
    assert.equal(published[0].videoId, "vidJob1");
    assert.equal(published[0].privacyStatus, "unlisted");
  });

  test("a record for a session that isn't yours or isn't finished is refused up front", async () => {
    fake = gatedGoogle();
    _setGoogleImpl(fake.google);
    const { a, dataDir, outputDir } = app();
    fs.writeFileSync(path.join(outputDir, "long.mp4"), "vid");
    const draft = createProject(dataDir, { title: "Rest", theme: "rest", targetSec: 600 });
    for (const ambientProjectId of ["../../etc", "missing", draft.projectId]) {
      const res = await request(a).post("/api/social/youtube/publish").send({
        videoUrl: "/outputs/long.mp4", title: "Rest", record: { ambientProjectId },
      });
      assert.equal(res.status, 400, ambientProjectId);
    }
    assert.equal(fake.calls.insert, 0);
  });
});

describe("a video fetched for upload", () => {
  afterEach(() => { _resetGoogleImpl(); _resetFetchImpl(); _resetPublishJobs(); });

  test("a download that breaks half way leaves no partial file behind", async () => {
    const fake = gatedGoogle();
    _setGoogleImpl(fake.google);
    fake.release();
    const { a, outputDir } = app();
    _setFetchImpl(async () => ({
      ok: true,
      body: new Readable({
        read() {
          this.push(Buffer.from("some bytes"));
          this.destroy(new Error("simulated ECONNRESET"));
        },
      }),
    }));
    const res = await request(a).post("/api/social/youtube/publish").send({ videoUrl: "https://example.com/v.mp4", title: "T" });
    const job = await waitForJob(a, res.body.jobId);
    assert.equal(job.status, "error");
    const left = fs.readdirSync(outputDir).filter((f) => f.startsWith("youtube-upload-"));
    assert.deepEqual(left, []);
  });
});
