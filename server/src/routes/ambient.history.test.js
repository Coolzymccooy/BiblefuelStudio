import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";

import ambientRouter, {
  AMBIENT_STATUS, _setQuotaImpl, _resetQuotaImpl,
  _setImageGenImpl, _resetImageGenImpl, _setImageLibraryImpl, _resetImageLibraryImpl,
  renderStage, markCancelled, isCancelled,
} from "./ambient.js";
import { readProject, writeProject } from "../lib/ambient/projectStore.js";

/**
 * The session history: listing finished sessions, deleting them, and keeping
 * a record of where each one was published so an old video can go out again.
 */

let root, dataDir, outputDir, app;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "amb-hist-"));
  dataDir = path.join(root, "users", "u1");
  outputDir = path.join(dataDir, "outputs");
  fs.mkdirSync(outputDir, { recursive: true });
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.ctx = { userId: "u1", plan: "premium", dataDir, outputDir }; next(); });
  app.use("/api/ambient", ambientRouter);
  _setQuotaImpl(() => (_req, _res, next) => next());
});

afterEach(() => {
  _resetQuotaImpl(); _resetImageGenImpl(); _resetImageLibraryImpl();
  fs.rmSync(root, { recursive: true, force: true });
});

async function createSession(body = {}) {
  const res = await request(app).post("/api/ambient")
    .send({ title: "Still Waters", theme: "rest", targetSec: 600, ...body });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.project;
}

/** A session whose render finished, with its video on disk. */
async function finishedSession(body = {}) {
  const p = await createSession(body);
  const dir = path.join(outputDir, "ambient", p.projectId);
  fs.mkdirSync(dir, { recursive: true });
  const video = path.join(dir, "video.mp4");
  fs.writeFileSync(video, "mp4");
  return writeProject(dataDir, {
    ...readProject(dataDir, p.projectId),
    status: AMBIENT_STATUS.DONE,
    render: { jobId: "j", outputPath: video, status: "done", percent: 100, phase: "" },
  });
}

describe("security: a project id is a name, never a path", () => {
  // Express decodes %2F inside a route parameter, so "..%2F.." arrives as a
  // relative path. The id must never leave the tenant's ambient folder.
  const plant = () => {
    const other = path.join(root, "users", "u2");
    fs.mkdirSync(other, { recursive: true });
    const file = path.join(other, "secret.json");
    fs.writeFileSync(file, JSON.stringify({ projectId: "secret", title: "another tenant" }));
    return file;
  };
  const traversal = encodeURIComponent("../../u2/secret");

  test("GET cannot read a JSON file outside the ambient folder", async () => {
    plant();
    const res = await request(app).get(`/api/ambient/${traversal}`);
    assert.equal(res.status, 404);
    assert.equal(JSON.stringify(res.body).includes("another tenant"), false);
  });

  test("DELETE cannot remove a JSON file outside the ambient folder", async () => {
    const file = plant();
    const res = await request(app).delete(`/api/ambient/${traversal}`);
    assert.equal(res.status, 404);
    assert.equal(fs.existsSync(file), true);
  });

  test("a write cannot be steered outside the folder either", async () => {
    assert.throws(() => writeProject(dataDir, { projectId: "../../escape", title: "x" }), /invalid project id/i);
    assert.equal(fs.existsSync(path.join(root, "users", "escape.json")), false);
  });
});

describe("GET /api/ambient — the history list", () => {
  test("says how long each session is, its shape, and whether its video exists", async () => {
    await finishedSession({ title: "Done one", aspect: "portrait" });
    await createSession({ title: "Draft one" });
    const { body } = await request(app).get("/api/ambient");
    const byTitle = Object.fromEntries(body.projects.map((p) => [p.title, p]));
    assert.equal(byTitle["Done one"].hasVideo, true);
    assert.equal(byTitle["Done one"].aspect, "portrait");
    assert.equal(byTitle["Done one"].targetSec, 600);
    assert.equal(byTitle["Draft one"].hasVideo, false);
    assert.equal(byTitle["Draft one"].lastPublished, null);
  });

  test("a done session whose video has been removed is not offered as watchable", async () => {
    const p = await finishedSession();
    fs.rmSync(path.join(outputDir, "ambient", p.projectId), { recursive: true });
    const { body } = await request(app).get("/api/ambient");
    assert.equal(body.projects[0].hasVideo, false);
  });

  test("never exposes server paths", async () => {
    await finishedSession();
    const { body } = await request(app).get("/api/ambient");
    const raw = JSON.stringify(body);
    assert.equal(raw.includes("outputs"), false);
    assert.equal(raw.includes("video.mp4"), false);
  });
});

describe("DELETE /api/ambient/:id — the whole session goes", () => {
  test("removes the video with the project, so deleted sessions don't fill the disk", async () => {
    const p = await finishedSession();
    const dir = path.join(outputDir, "ambient", p.projectId);
    const res = await request(app).delete(`/api/ambient/${p.projectId}`);
    assert.equal(res.status, 200);
    assert.equal(fs.existsSync(dir), false);
    assert.equal(readProject(dataDir, p.projectId), null);
  });

  test("refuses while the session is rendering, rather than pulling files from under ffmpeg", async () => {
    const p = await finishedSession();
    writeProject(dataDir, { ...readProject(dataDir, p.projectId), status: AMBIENT_STATUS.RENDERING });
    const res = await request(app).delete(`/api/ambient/${p.projectId}`);
    assert.equal(res.status, 409);
    assert.notEqual(readProject(dataDir, p.projectId), null);
  });
});

describe("deleting never leaves a session stuck, or brings one back", () => {
  test("a session stuck mid-pictures (say, after a restart) can still be deleted", async () => {
    const p = await createSession();
    writeProject(dataDir, { ...readProject(dataDir, p.projectId), status: AMBIENT_STATUS.GENERATING_IMAGES });
    assert.equal((await request(app).delete(`/api/ambient/${p.projectId}`)).status, 200);
  });

  test("a picture stage still running when its session is deleted does not write it back", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    _setImageLibraryImpl({ find: async () => [], register: async () => ({ id: "x" }), mark: () => {} });
    _setImageGenImpl(async () => { await gate; return { ok: true, path: path.join(outputDir, "img.png") }; });
    const p = await createSession();
    await request(app).post(`/api/ambient/${p.projectId}/images`).send({});
    assert.equal((await request(app).delete(`/api/ambient/${p.projectId}`)).status, 200);
    release();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(readProject(dataDir, p.projectId), null, "the deleted session came back");
  });

  test("the folder removed is the one the URL named, whatever the file claims", async () => {
    const keep = await finishedSession({ title: "Keep" });
    const doomed = await finishedSession({ title: "Doomed" });
    // A file whose own projectId strips to nothing must not become outputs/ambient.
    fs.writeFileSync(
      path.join(dataDir, "ambient", `${doomed.projectId}.json`),
      JSON.stringify({ ...readProject(dataDir, doomed.projectId), projectId: "../" }),
    );
    assert.equal((await request(app).delete(`/api/ambient/${doomed.projectId}`)).status, 200);
    assert.equal(fs.existsSync(path.join(outputDir, "ambient", keep.projectId, "video.mp4")), true);
    assert.equal(fs.existsSync(path.join(outputDir, "ambient", doomed.projectId)), false);
  });

  test("a render cancelled while the bed is built stops before encoding", async () => {
    const bedFile = path.join(outputDir, "bed.mp3");
    fs.writeFileSync(bedFile, "mp3");
    const p = await createSession();
    writeProject(dataDir, {
      ...readProject(dataDir, p.projectId),
      bed: { ...readProject(dataDir, p.projectId).bed, mode: "file", filePath: bedFile },
    });
    markCancelled(p.projectId);
    await assert.rejects(renderStage({ dataDir, outputDir }, p.projectId, "job-x"), /Cancelled/);
    assert.equal(isCancelled(p.projectId), false, "the flag is consumed, not left to cancel the next render");
  });
});

describe("POST /api/ambient/:id/published — a record of where the video went", () => {
  test("keeps each upload, newest last, with a link the server builds itself", async () => {
    const p = await finishedSession();
    const first = await request(app).post(`/api/ambient/${p.projectId}/published`)
      .send({ videoId: "abcDEF12345", privacyStatus: "private" });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const second = await request(app).post(`/api/ambient/${p.projectId}/published`)
      .send({ videoId: "zzzYYY_-987", privacyStatus: "public", publishAt: "2026-10-01T09:00:00.000Z" });
    const published = second.body.project.published;
    assert.equal(published.length, 2);
    assert.equal(published[1].videoId, "zzzYYY_-987");
    assert.equal(published[1].url, "https://youtu.be/zzzYYY_-987");
    assert.equal(published[1].privacyStatus, "public");
    assert.equal(published[1].publishAt, "2026-10-01T09:00:00.000Z");
    assert.equal(typeof published[1].at, "number");

    const list = await request(app).get("/api/ambient");
    assert.equal(list.body.projects[0].lastPublished.videoId, "zzzYYY_-987");
  });

  test("a video id that isn't one is refused — it becomes a link on the page", async () => {
    const p = await finishedSession();
    for (const videoId of ["javascript:alert(1)", "", "a/b", "x".repeat(40)]) {
      const res = await request(app).post(`/api/ambient/${p.projectId}/published`).send({ videoId });
      assert.equal(res.status, 400, videoId);
    }
  });

  test("an unknown privacy is stored as private, and a bad date is dropped", async () => {
    const p = await finishedSession();
    const res = await request(app).post(`/api/ambient/${p.projectId}/published`)
      .send({ videoId: "abcDEF12345", privacyStatus: "everyone", publishAt: "tomorrow-ish", url: "https://evil.example" });
    const [entry] = res.body.project.published;
    assert.equal(entry.privacyStatus, "private");
    assert.equal(entry.publishAt, null);
    assert.equal(entry.url, "https://youtu.be/abcDEF12345");
  });

  test("only a finished session can have been published", async () => {
    const p = await createSession();
    const res = await request(app).post(`/api/ambient/${p.projectId}/published`).send({ videoId: "abcDEF12345" });
    assert.equal(res.status, 409);
  });

  test("keeps the most recent twenty", async () => {
    const p = await finishedSession();
    for (let i = 0; i < 22; i++) {
      await request(app).post(`/api/ambient/${p.projectId}/published`).send({ videoId: `video${String(i).padStart(6, "0")}` });
    }
    const stored = readProject(dataDir, p.projectId).published;
    assert.equal(stored.length, 20);
    assert.equal(stored[19].videoId, "video000021");
  });
});
