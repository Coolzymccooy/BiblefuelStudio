import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import express from "express";
import request from "supertest";
import { createVisualLibraryRouter } from "./visualLibrary.js";
import { requireSuperAdmin } from "../middleware/requireSuperAdmin.js";
import { addClip, readLibrary, updateClip } from "../lib/visualLibrary/store.js";
import { createProject, readProject, writeProject } from "../lib/story/projectStore.js";

describe("browsing the visual library", () => {
  let root;
  let ctx;
  let app;
  const posterCalls = [];
  const failIds = new Set();
  const file = (name, dir = root) => {
    const f = path.join(dir, name);
    fs.writeFileSync(f, "mp4");
    return f;
  };

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "vl-browse-"));
    ctx = { dataDir: path.join(root, "data"), outputDir: path.join(root, "out") };
    fs.mkdirSync(ctx.outputDir, { recursive: true });
    const deps = {
      poster: async (clipFile, out) => {
        posterCalls.push(clipFile);
        if (failIds.has(path.basename(path.dirname(clipFile)))) return false;
        fs.writeFileSync(out, "jpg");
        return true;
      },
      probe: async (clipFile) => {
        // A slow probe, so two back-fills started together really overlap.
        if (clipFile.includes("twice")) await new Promise((r) => setTimeout(r, 150));
        return path.basename(clipFile).startsWith("story-") ? { durationSec: 8.04 } : null;
      },
    };
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.ctx = { ...ctx, isSuperAdmin: true }; next(); });
    app.use("/api/visual-library", requireSuperAdmin, createVisualLibraryRouter({ deps }));
  });
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  test("filters by lead character, tag and rating, and lists the leads", async () => {
    const lead = "a shepherd boy in a linen tunic";
    const a = addClip(ctx, { file: file("a.mp4"), prompt: `${lead} calls out`, lead, tags: ["lamb"] });
    addClip(ctx, { file: file("b.mp4"), prompt: "Hills at sunset", tags: ["lamb"] });
    updateClip(ctx.dataDir, a.id, { rating: 4 });
    const byLead = await request(app).get("/api/visual-library").query({ lead });
    assert.deepEqual(byLead.body.clips.map((c) => c.id), [a.id]);
    const byTag = await request(app).get("/api/visual-library").query({ tag: "lamb", rating: "4" });
    assert.deepEqual(byTag.body.clips.map((c) => c.id), [a.id]);
    const junk = await request(app).get("/api/visual-library").query({ rating: "lots", tag: "x".repeat(500), limit: "9999" });
    assert.equal(junk.status, 200);
    const one = await request(app).get("/api/visual-library").query({ limit: "1" });
    assert.equal(one.body.clips.length, 1);
    assert.equal(one.body.total, 2);
    const leads = await request(app).get("/api/visual-library/leads");
    assert.deepEqual(leads.body.leads, [{ lead, clips: 1 }]);
  });

  test("makes posters for clips that have none, and reports the ones it could not", async () => {
    const before = readLibrary(ctx.dataDir).filter((c) => !c.posterUrl).length;
    const broken = addClip(ctx, { file: file("broken.mp4"), prompt: "x" });
    failIds.add(broken.id);
    const r = await request(app).post("/api/visual-library/posters");
    assert.equal(r.status, 200);
    assert.equal(r.body.made, before);
    assert.equal(r.body.failed, 1);
    assert.equal(r.body.remaining, 0);
    const clips = readLibrary(ctx.dataDir);
    assert.ok(clips.filter((c) => c.id !== broken.id).every((c) => c.posterUrl));
    assert.equal(clips.find((c) => c.id === broken.id).posterUrl, null);
    posterCalls.length = 0;
    const again = await request(app).post("/api/visual-library/posters");
    assert.deepEqual(posterCalls, [], "a clip whose poster failed is not tried again");
    assert.deepEqual(again.body, { ok: true, made: 0, failed: 0, remaining: 0 });
  });

  test("brings older Story AI clips into the library once, leaving other scenes alone", async () => {
    const project = createProject(ctx.dataDir, { title: "Grace Beyond the Race", aspect: "portrait" });
    const old = file("story-old.mp4", ctx.outputDir);
    const kept = file("story-kept.mp4", ctx.outputDir);
    const photo = file("story-photo.mp4", ctx.outputDir);
    const outside = file("story-outside.mp4");
    writeProject(ctx.dataDir, {
      ...project,
      updatedAt: 1000,
      scenes: [
        { id: "s1", mediaKind: "video", aiVideoClip: true, aiVideoStatus: "done", videoPath: old, aiVideoPrompt: "A runner at dawn" },
        { id: "s2", mediaKind: "video", aiVideoClip: true, aiVideoStatus: "done", videoPath: kept, aiVideoLibraryId: "0f8c2a4e-1b3d-4c5e-8f9a-000000000001" },
        { id: "s3", mediaKind: "video", videoPath: photo },
        { id: "s4", mediaKind: "video", aiVideoClip: true, aiVideoStatus: "done", videoPath: path.join(root, "gone.mp4") },
        { id: "s5", mediaKind: "video", aiVideoClip: true, aiVideoStatus: "generating", videoPath: file("story-busy.mp4", ctx.outputDir) },
        { id: "s6", mediaKind: "video", aiVideoClip: true, aiVideoStatus: "done", videoPath: outside },
      ],
    });
    const count = readLibrary(ctx.dataDir).length;
    const r = await request(app).post("/api/visual-library/backfill-story");
    assert.equal(r.status, 200);
    assert.equal(r.body.added, 1);
    assert.equal(r.body.remaining, 0);
    const library = readLibrary(ctx.dataDir);
    assert.equal(library.length, count + 1);
    const added = library[0];
    assert.equal(added.prompt, "A runner at dawn");
    assert.deepEqual(added.source, { kind: "story", projectId: project.projectId, sceneId: "s1" });
    assert.equal(fs.existsSync(old), true, "the scene keeps its own copy");
    const scenes = readProject(ctx.dataDir, project.projectId).scenes;
    assert.equal(scenes[0].aiVideoLibraryId, added.id);
    assert.equal(scenes[2].aiVideoLibraryId, undefined);
    assert.equal(scenes[5].aiVideoLibraryId, undefined, "a file outside the outputs folder is never copied");
    assert.equal(readProject(ctx.dataDir, project.projectId).updatedAt, 1000, "the Story list order is left alone");
    assert.deepEqual(added.tags, ["grace beyond the race"]);
    assert.equal(added.durationSec, 8.04, "the clip keeps its length so a reused shot can be held or trimmed");
    const again = await request(app).post("/api/visual-library/backfill-story");
    assert.equal(again.body.added, 0);
  });

  test("two back-fills at once copy each clip only once", async () => {
    const project = createProject(ctx.dataDir, { title: "Twice" });
    writeProject(ctx.dataDir, {
      ...project,
      scenes: [{ id: "s1", mediaKind: "video", aiVideoClip: true, aiVideoStatus: "done", videoPath: file("story-twice.mp4", ctx.outputDir) }],
    });
    const count = readLibrary(ctx.dataDir).length;
    const [a, b] = await Promise.all([
      request(app).post("/api/visual-library/backfill-story"),
      request(app).post("/api/visual-library/backfill-story"),
    ]);
    assert.equal(a.body.added + b.body.added <= 2, true);
    assert.equal(readLibrary(ctx.dataDir).length, count + 1);
  });

  test("a Story clip without its prompt is kept as prompt unknown", async () => {
    const project = createProject(ctx.dataDir, { title: "Old one" });
    writeProject(ctx.dataDir, {
      ...project,
      scenes: [{ id: "s1", mediaKind: "video", aiVideoClip: true, aiVideoStatus: "done", videoPath: file("story-noprompt.mp4", ctx.outputDir) }],
    });
    await request(app).post("/api/visual-library/backfill-story");
    const clip = readLibrary(ctx.dataDir).find((c) => c.source?.projectId === project.projectId);
    assert.equal(clip.promptKnown, false);
  });
});

describe("Story back-fill batches", () => {
  test("adds a batch at a time and says how many remain", async () => {
    const { backfillStoryClips, titleTag } = await import("../lib/visualLibrary/backfill.js");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vl-batch-"));
    try {
      const ctx = { dataDir: path.join(root, "data"), outputDir: path.join(root, "out") };
      fs.mkdirSync(ctx.outputDir, { recursive: true });
      const project = createProject(ctx.dataDir, { title: "Joseph, the dreamer" });
      const scenes = [1, 2, 3].map((n) => {
        const f = path.join(ctx.outputDir, `s${n}.mp4`);
        fs.writeFileSync(f, "mp4");
        return { id: `s${n}`, mediaKind: "video", aiVideoClip: true, aiVideoStatus: "done", videoPath: f };
      });
      writeProject(ctx.dataDir, { ...project, scenes });
      const probe = async () => ({ durationSec: 5 });
      assert.deepEqual(await backfillStoryClips(ctx, { limit: 2, probe }), { added: 2, remaining: 1 });
      assert.deepEqual(await backfillStoryClips(ctx, { limit: 2, probe }), { added: 1, remaining: 0 });
      assert.deepEqual(readLibrary(ctx.dataDir)[0].tags, ["joseph the dreamer"]);
      assert.equal(titleTag("The Prodigal Son Comes Home After Many Long Years Away"), "The Prodigal Son Comes Home After Many");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
