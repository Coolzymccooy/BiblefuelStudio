import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import musicRouter, { _setSeparatorImpl, _resetSeparatorImpl, _setDurationProbe, _resetDurationProbe } from "./music.js";
import { _resetBundledDurations } from "../lib/musicLibrary.js";
import { registerTrack, readMusicLibrary } from "../lib/musicLibraryStore.js";
import { _resetStemJobs } from "../lib/stems/stemJobs.js";
import { _resetHeavyGate } from "../lib/heavyJobGate.js";

function handlerFor(method, routePath) {
  const layer = musicRouter.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
  if (!layer) throw new Error(`no handler for ${method} ${routePath}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}
function res() {
  return { payload: null, statusCode: 200, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; } };
}
function tenant() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-music-route-"));
  const outputDir = path.join(dir, "out");
  fs.mkdirSync(outputDir, { recursive: true });
  const file = path.join(outputDir, "user-audio-1.mp3");
  fs.writeFileSync(file, "a real file on disk");
  return { ctx: { dataDir: dir, outputDir }, file };
}

describe("music route", () => {
  test("GET /library still lists the 23 bundled tracks, now tagged", async () => {
    const r = res();
    await handlerFor("get", "/library")({ ctx: tenant().ctx }, r);
    assert.equal(r.payload.ok, true);
    const bundled = r.payload.tracks.filter((t) => t.source === "bundled");
    assert.equal(bundled.length, 23);
    assert.match(bundled[0].previewUrl, /^\/music\//);
    assert.equal(bundled[0].licence, "pixabay-cleared");
  });

  test("GET /library gives the bundled tracks their probed length", async () => {
    _resetBundledDurations();
    _setDurationProbe(async (file) => (file.endsWith("01-peaceful-worship.mp3") ? 229 : 100));
    try {
      const r = res();
      await handlerFor("get", "/library")({ ctx: tenant().ctx }, r);
      const pw = r.payload.tracks.find((t) => t.id === "peaceful-worship");
      assert.equal(pw.durationSec, 229);
    } finally {
      _resetDurationProbe();
      _resetBundledDurations();
    }
  });

  test("GET /library merges the tenant's own uploads after the bundled ones", async () => {
    const { ctx, file } = tenant();
    registerTrack(ctx.dataDir, { file, label: "My Bed", licence: "unknown" });
    const r = res();
    await handlerFor("get", "/library")({ ctx }, r);
    const mine = r.payload.tracks.filter((t) => t.source === "upload");
    assert.equal(mine.length, 1);
    assert.equal(mine[0].label, "My Bed");
    assert.equal(mine[0].licence, "unknown");
    assert.equal(r.payload.tracks.length, 24);
  });

  test("GET /library tells the picker which output file plays an upload (its UUID name), never the full path", async () => {
    const { ctx, file } = tenant();
    registerTrack(ctx.dataDir, { file, label: "My Bed" });
    const r = res();
    await handlerFor("get", "/library")({ ctx }, r);
    const mine = r.payload.tracks.find((t) => t.source === "upload");
    assert.equal(mine.mediaFile, "user-audio-1.mp3");
    assert.equal(Object.values(mine).some((v) => typeof v === "string" && v.includes(path.basename(ctx.dataDir))), false, "no server path leaks");
  });

  test("POST /upload registers a file that is already in the caller's output dir", async () => {
    const { ctx, file } = tenant();
    const r = res();
    await handlerFor("post", "/upload")({ ctx, body: { file, label: "Saved", mood: "calm", licence: "cleared" } }, r);
    assert.equal(r.payload.ok, true);
    assert.equal(r.payload.track.label, "Saved");
    assert.equal(r.payload.track.source, "upload");
  });

  test("POST /upload accepts a bare file name from the caller's media folder (a loose Timeline file)", async () => {
    const { ctx, file } = tenant();
    const r = res();
    await handlerFor("post", "/upload")({ ctx, body: { file: path.basename(file) } }, r);
    assert.equal(r.payload.ok, true);
    assert.equal(readMusicLibrary(ctx.dataDir).items[0].file, fs.realpathSync(file));
  });

  test("POST /upload still refuses a relative path that climbs out of the media folder", async () => {
    const { ctx } = tenant();
    fs.writeFileSync(path.join(ctx.dataDir, "secret.mp3"), "x");
    const r = res();
    await handlerFor("post", "/upload")({ ctx, body: { file: "../secret.mp3" } }, r);
    assert.equal(r.statusCode, 403);
  });

  test("POST /upload refuses a path outside the caller's own media folder", async () => {
    const { ctx } = tenant();
    const outsider = path.join(os.tmpdir(), "somebody-elses.mp3");
    fs.writeFileSync(outsider, "x");
    const r = res();
    await handlerFor("post", "/upload")({ ctx, body: { file: outsider, label: "Nope" } }, r);
    assert.equal(r.statusCode, 403);
    assert.equal(r.payload.ok, false);
  });

  test("POST /upload refuses a file that is not there", async () => {
    const { ctx } = tenant();
    const r = res();
    await handlerFor("post", "/upload")({ ctx, body: { file: path.join(ctx.outputDir, "ghost.mp3") } }, r);
    assert.equal(r.statusCode, 400);
  });

  test("PATCH /:id changes the licence; an unknown id is a 404", async () => {
    const { ctx, file } = tenant();
    const t = registerTrack(ctx.dataDir, { file, label: "Bed" });
    const ok = res();
    await handlerFor("patch", "/:id")({ ctx, params: { id: t.id }, body: { licence: "cleared" } }, ok);
    assert.equal(ok.payload.track.licence, "cleared");
    const missing = res();
    await handlerFor("patch", "/:id")({ ctx, params: { id: "nope" }, body: { licence: "cleared" } }, missing);
    assert.equal(missing.statusCode, 404);
  });

  test("DELETE /:id forgets an upload but refuses a bundled track", async () => {
    const { ctx, file } = tenant();
    const t = registerTrack(ctx.dataDir, { file, label: "Bed" });
    const gone = res();
    await handlerFor("delete", "/:id")({ ctx, params: { id: t.id } }, gone);
    assert.equal(gone.payload.ok, true);
    const bundled = res();
    await handlerFor("delete", "/:id")({ ctx, params: { id: "peaceful-worship" } }, bundled);
    assert.equal(bundled.statusCode, 400, "bundled tracks ship with the app and are not the tenant's to delete");
  });

  test("POST /upload refuses a symlink that escapes the tenant's folder", async (t) => {
    const { ctx } = tenant();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "bf-music-outside-"));
    const outsideFile = path.join(outside, "external.mp3");
    fs.writeFileSync(outsideFile, "external file");
    const linkPath = path.join(ctx.outputDir, "evil-link.mp3");
    try {
      fs.symlinkSync(outsideFile, linkPath);
    } catch (e) {
      if (e.code === "EPERM") {
        // Windows without developer mode cannot create symlinks; skip gracefully.
        t.skip("cannot create symlinks without developer mode (EPERM)");
        return;
      }
      throw e;
    }
    const r = res();
    await handlerFor("post", "/upload")({ ctx, body: { file: linkPath, label: "Evil" } }, r);
    assert.equal(r.statusCode, 403, "symlink must not escape the tenant's folder");
    assert.equal(r.payload.ok, false);
    fs.rmSync(outside, { recursive: true });
  });

  test("POST /upload refuses the output directory itself (file !== root allows file === root)", async () => {
    const { ctx } = tenant();
    const r = res();
    await handlerFor("post", "/upload")({ ctx, body: { file: ctx.outputDir, label: "Whole folder" } }, r);
    assert.equal(r.statusCode, 400);
    assert.equal(r.payload.ok, false);
  });

  test("POST /upload refuses a non-audio regular file inside the media folder (e.g. a stray .json)", async () => {
    const { ctx } = tenant();
    const jsonFile = path.join(ctx.outputDir, "notes.json");
    fs.writeFileSync(jsonFile, "{}");
    const r = res();
    await handlerFor("post", "/upload")({ ctx, body: { file: jsonFile, label: "Notes" } }, r);
    // Not a security boundary violation (403) — just not the shape of thing
    // this route registers. Nothing in the route restricts by extension, so
    // this documents the isFile() guard rather than a content-type check.
    assert.equal(r.statusCode, 200, "a regular file is accepted regardless of extension");
    assert.equal(r.payload.ok, true);
  });

  test("POST /upload stores the canonicalized realpath, not a symlink, so a later swap can't redirect the track", async (t) => {
    const { ctx } = tenant();
    const realTarget = path.join(ctx.outputDir, "real-track.mp3");
    fs.writeFileSync(realTarget, "audio bytes");
    const linkPath = path.join(ctx.outputDir, "link-track.mp3");
    try {
      fs.symlinkSync(realTarget, linkPath);
    } catch (e) {
      if (e.code === "EPERM") {
        t.skip("cannot create symlinks without developer mode (EPERM)");
        return;
      }
      throw e;
    }
    const r = res();
    await handlerFor("post", "/upload")({ ctx, body: { file: linkPath, label: "Linked" } }, r);
    assert.equal(r.payload.ok, true, JSON.stringify(r.payload));
    const stored = readMusicLibrary(ctx.dataDir).items.find((t2) => t2.label === "Linked");
    assert.equal(stored.file, fs.realpathSync(realTarget), "the index must hold the real file, not the symlink path");
  });

  test("a track's credit is saved, trimmed and capped at 200 characters", async () => {
    const { ctx, file } = tenant();
    const t = registerTrack(ctx.dataDir, { file, label: "Bed" });
    const r = res();
    await handlerFor("patch", "/:id")({ ctx, params: { id: t.id }, body: { credit: `  ${"x".repeat(250)}  ` } }, r);
    assert.equal(r.payload.ok, true);
    assert.equal(r.payload.track.credit.length, 200);
  });

  test("bundled tracks are credited to Pixabay", async () => {
    const r = res();
    await handlerFor("get", "/library")({ ctx: tenant().ctx }, r);
    const bundled = r.payload.tracks.find((t) => t.source === "bundled");
    assert.equal(bundled.credit, "Music from Pixabay");
  });

  test("an upload with no credit lists an empty credit", async () => {
    const { ctx, file } = tenant();
    registerTrack(ctx.dataDir, { file, label: "Bed" });
    const r = res();
    await handlerFor("get", "/library")({ ctx }, r);
    assert.equal(r.payload.tracks.find((t) => t.source === "upload").credit, "");
  });
});

describe("vocal removal routes", () => {
  afterEach(() => { _resetSeparatorImpl(); _resetStemJobs(); _resetHeavyGate(); });

  const call = async (method, route, req) => { const r = res(); await handlerFor(method, route)(req, r); return r; };
  // NOTE: `!(await pred())`, not `!pred()` — pred is async, and `!pred()`
  // would negate a pending Promise (always truthy) and never actually poll.
  const until = async (pred) => { for (let i = 0; i < 200 && !(await pred()); i += 1) await new Promise((r) => setTimeout(r, 5)); };

  test("capabilities say no when the separator is not set up", async () => {
    _setSeparatorImpl({ available: async () => ({ ok: false }) });
    const r = await call("get", "/capabilities", { ctx: tenant().ctx });
    assert.equal(r.payload.vocalRemoval, false);
  });

  test("starting a separation is refused when not set up", async () => {
    const { ctx, file } = tenant();
    const t = registerTrack(ctx.dataDir, { file, label: "Song" });
    _setSeparatorImpl({ available: async () => ({ ok: false }) });
    const r = await call("post", "/:id/instrumental", { ctx: { ...ctx, userId: "u1" }, params: { id: t.id }, body: {} });
    assert.equal(r.statusCode, 409);
  });

  test("an unknown track is 404, never a path from the request", async () => {
    _setSeparatorImpl({ available: async () => ({ ok: true }) });
    const r = await call("post", "/:id/instrumental", { ctx: { ...tenant().ctx, userId: "u1" }, params: { id: "../../etc/passwd" }, body: {} });
    assert.equal(r.statusCode, 404);
  });

  test("keep saves a new track that inherits licence and credit, and leaves the original alone", async () => {
    const { ctx, file } = tenant();
    const src = registerTrack(ctx.dataDir, { file, label: "Song", licence: "unknown", credit: "Choir X", mood: "worship" });
    let seenInput;
    _setSeparatorImpl({
      available: async () => ({ ok: true }),
      remove: async ({ input, outPath, onProgress }) => { seenInput = input; onProgress(40); fs.writeFileSync(outPath, "m4a"); return outPath; },
    });
    const c = { ...ctx, userId: "u1" };
    const started = await call("post", "/:id/instrumental", { ctx: c, params: { id: src.id }, body: { quality: "fast" } });
    assert.equal(started.payload.ok, true);
    const { jobId } = started.payload;
    await until(async () => (await call("get", "/instrumental/:jobId", { ctx: c, params: { jobId } })).payload.job.status === "done");
    assert.equal(fs.realpathSync(seenInput), fs.realpathSync(file));
    const kept = await call("post", "/instrumental/:jobId/keep", { ctx: c, params: { jobId } });
    assert.equal(kept.payload.ok, true);
    assert.equal(kept.payload.track.label, "Song (instrumental)");
    assert.equal(kept.payload.track.licence, "unknown");
    assert.equal(kept.payload.track.credit, "Choir X");
    assert.equal(kept.payload.track.derivedFrom, `mylib:${src.id}`);
    const lib = readMusicLibrary(ctx.dataDir).items;
    assert.equal(lib.find((t) => t.id === src.id).label, "Song");
    assert.equal(lib.length, 2);
  });

  test("another user's job is 404", async () => {
    const { ctx, file } = tenant();
    const src = registerTrack(ctx.dataDir, { file, label: "Song" });
    _setSeparatorImpl({ available: async () => ({ ok: true }), remove: async ({ outPath }) => { fs.writeFileSync(outPath, "x"); return outPath; } });
    const started = await call("post", "/:id/instrumental", { ctx: { ...ctx, userId: "u1" }, params: { id: src.id }, body: {} });
    const r = await call("get", "/instrumental/:jobId", { ctx: { ...ctx, userId: "u2" }, params: { jobId: started.payload.jobId } });
    assert.equal(r.statusCode, 404);
  });

  test("discard deletes the result and forgets the job", async () => {
    const { ctx, file } = tenant();
    const src = registerTrack(ctx.dataDir, { file, label: "Song" });
    let out;
    _setSeparatorImpl({ available: async () => ({ ok: true }), remove: async ({ outPath }) => { out = outPath; fs.writeFileSync(outPath, "x"); return outPath; } });
    const c = { ...ctx, userId: "u1" };
    const { payload } = await call("post", "/:id/instrumental", { ctx: c, params: { id: src.id }, body: {} });
    await until(() => out && fs.existsSync(out));
    await until(async () => (await call("get", "/instrumental/:jobId", { ctx: c, params: { jobId: payload.jobId } })).payload.job.status === "done");
    await call("post", "/instrumental/:jobId/discard", { ctx: c, params: { jobId: payload.jobId } });
    assert.equal(fs.existsSync(out), false);
    assert.equal((await call("get", "/instrumental/:jobId", { ctx: c, params: { jobId: payload.jobId } })).statusCode, 404);
  });

  test("a failed separation reports its error and leaves no file", async () => {
    const { ctx, file } = tenant();
    const src = registerTrack(ctx.dataDir, { file, label: "Song" });
    let out;
    _setSeparatorImpl({
      available: async () => ({ ok: true }),
      // A separator can fail AFTER it already wrote a partial/failed output
      // (e.g. it crashes during the ffmpeg re-encode step) — write the file
      // before throwing so this test covers the cleanup path, not just the
      // "never wrote anything" case.
      remove: async ({ outPath }) => { out = outPath; fs.writeFileSync(outPath, "partial"); throw new Error("out of memory"); },
    });
    const c = { ...ctx, userId: "u1" };
    const { payload } = await call("post", "/:id/instrumental", { ctx: c, params: { id: src.id }, body: {} });
    await until(async () => (await call("get", "/instrumental/:jobId", { ctx: c, params: { jobId: payload.jobId } })).payload.job.status === "error");
    const job = (await call("get", "/instrumental/:jobId", { ctx: c, params: { jobId: payload.jobId } })).payload.job;
    assert.match(job.error, /out of memory/);
    assert.equal(fs.existsSync(out), false, "the partial result must be cleaned up");
  });

  test("a failed separation still ends the job as 'error' even when the result file cannot be deleted", async () => {
    const { ctx, file } = tenant();
    const src = registerTrack(ctx.dataDir, { file, label: "Song" });
    let out;
    _setSeparatorImpl({
      available: async () => ({ ok: true }),
      remove: async ({ outPath }) => { out = outPath; fs.writeFileSync(outPath, "partial"); throw new Error("out of memory"); },
    });
    const c = { ...ctx, userId: "u1" };
    const realRmSync = fs.rmSync;
    fs.rmSync = (p, opts) => {
      if (out && path.resolve(String(p)) === path.resolve(out)) {
        throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
      }
      return realRmSync(p, opts);
    };
    try {
      const { payload } = await call("post", "/:id/instrumental", { ctx: c, params: { id: src.id }, body: {} });
      await until(async () => (await call("get", "/instrumental/:jobId", { ctx: c, params: { jobId: payload.jobId } })).payload.job.status === "error");
      const job = (await call("get", "/instrumental/:jobId", { ctx: c, params: { jobId: payload.jobId } })).payload.job;
      assert.equal(job.status, "error");
      assert.match(job.error, /out of memory/, "the separator's own error must win, not the cleanup failure");
    } finally {
      fs.rmSync = realRmSync;
      if (out) { try { realRmSync(out, { force: true }); } catch { /* best effort test cleanup */ } }
    }
  });

  test("a separator that reports success without writing a file ends as an error and registers nothing", async () => {
    const { ctx, file } = tenant();
    const src = registerTrack(ctx.dataDir, { file, label: "Song" });
    _setSeparatorImpl({ available: async () => ({ ok: true }), remove: async ({ outPath }) => outPath });
    const c = { ...ctx, userId: "u1" };
    const { payload } = await call("post", "/:id/instrumental", { ctx: c, params: { id: src.id }, body: {} });
    await until(async () => (await call("get", "/instrumental/:jobId", { ctx: c, params: { jobId: payload.jobId } })).payload.job.status === "error");
    const job = (await call("get", "/instrumental/:jobId", { ctx: c, params: { jobId: payload.jobId } })).payload.job;
    assert.equal(job.status, "error");
    assert.match(job.error, /no file/);
    assert.equal(readMusicLibrary(ctx.dataDir).items.length, 1, "no dangling track was registered");
  });

  test("a finished instrumental is saved to the library straight away — leaving the page cannot lose it", async () => {
    const { ctx, file } = tenant();
    const src = registerTrack(ctx.dataDir, { file, label: "Song", licence: "unknown", credit: "Choir X" });
    _setSeparatorImpl({ available: async () => ({ ok: true }), remove: async ({ outPath }) => { fs.writeFileSync(outPath, "m4a"); return outPath; } });
    const c = { ...ctx, userId: "u1" };
    const { payload } = await call("post", "/:id/instrumental", { ctx: c, params: { id: src.id }, body: {} });
    await until(async () => (await call("get", "/instrumental/:jobId", { ctx: c, params: { jobId: payload.jobId } })).payload.job.status === "done");
    const job = (await call("get", "/instrumental/:jobId", { ctx: c, params: { jobId: payload.jobId } })).payload.job;
    assert.equal(job.track.label, "Song (instrumental)");
    assert.equal(job.track.derivedFrom, `mylib:${src.id}`);
    assert.equal(job.track.credit, "Choir X");
    const lib = readMusicLibrary(ctx.dataDir).items;
    assert.equal(lib.length, 2, "saved without anyone pressing Keep");
    assert.equal(lib[1].id, job.track.id);
  });

  test("keep on an already-saved instrumental returns that track, not a duplicate", async () => {
    const { ctx, file } = tenant();
    const src = registerTrack(ctx.dataDir, { file, label: "Song" });
    _setSeparatorImpl({ available: async () => ({ ok: true }), remove: async ({ outPath }) => { fs.writeFileSync(outPath, "m4a"); return outPath; } });
    const c = { ...ctx, userId: "u1" };
    const { payload } = await call("post", "/:id/instrumental", { ctx: c, params: { id: src.id }, body: {} });
    await until(async () => (await call("get", "/instrumental/:jobId", { ctx: c, params: { jobId: payload.jobId } })).payload.job.status === "done");
    const job = (await call("get", "/instrumental/:jobId", { ctx: c, params: { jobId: payload.jobId } })).payload.job;
    const kept = await call("post", "/instrumental/:jobId/keep", { ctx: c, params: { jobId: payload.jobId } });
    assert.equal(kept.payload.track.id, job.track.id);
    assert.equal(readMusicLibrary(ctx.dataDir).items.length, 2);
  });

  test("discarding a saved instrumental takes it back out of the library", async () => {
    const { ctx, file } = tenant();
    const src = registerTrack(ctx.dataDir, { file, label: "Song" });
    let out;
    _setSeparatorImpl({ available: async () => ({ ok: true }), remove: async ({ outPath }) => { out = outPath; fs.writeFileSync(outPath, "m4a"); return outPath; } });
    const c = { ...ctx, userId: "u1" };
    const { payload } = await call("post", "/:id/instrumental", { ctx: c, params: { id: src.id }, body: {} });
    await until(async () => (await call("get", "/instrumental/:jobId", { ctx: c, params: { jobId: payload.jobId } })).payload.job.status === "done");
    await call("post", "/instrumental/:jobId/discard", { ctx: c, params: { jobId: payload.jobId } });
    assert.deepEqual(readMusicLibrary(ctx.dataDir).items.map((t) => t.id), [src.id]);
    assert.equal(fs.existsSync(out), false);
  });

  test("keep uses the licence/credit captured when the job started, even if the source is edited mid-job", async () => {
    const { ctx, file } = tenant();
    const src = registerTrack(ctx.dataDir, { file, label: "Song", licence: "unknown", credit: "Choir X", mood: "worship" });
    _setSeparatorImpl({
      available: async () => ({ ok: true }),
      remove: async ({ outPath }) => { fs.writeFileSync(outPath, "m4a"); return outPath; },
    });
    const c = { ...ctx, userId: "u1" };
    const { payload } = await call("post", "/:id/instrumental", { ctx: c, params: { id: src.id }, body: {} });
    await until(async () => (await call("get", "/instrumental/:jobId", { ctx: c, params: { jobId: payload.jobId } })).payload.job.status === "done");
    // Mutate the source's credit/licence AFTER the job started.
    await handlerFor("patch", "/:id")({ ctx: c, params: { id: src.id }, body: { credit: "Someone Else", licence: "cleared" } }, res());
    const kept = await call("post", "/instrumental/:jobId/keep", { ctx: c, params: { jobId: payload.jobId } });
    assert.equal(kept.payload.ok, true);
    assert.equal(kept.payload.track.credit, "Choir X", "credit captured at job start, not re-read at keep time");
    assert.equal(kept.payload.track.licence, "unknown", "licence captured at job start, not re-read at keep time");
  });
});
