import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import musicRouter from "./music.js";
import { registerTrack } from "../lib/musicLibraryStore.js";

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

  test("POST /upload registers a file that is already in the caller's output dir", async () => {
    const { ctx, file } = tenant();
    const r = res();
    await handlerFor("post", "/upload")({ ctx, body: { file, label: "Saved", mood: "calm", licence: "cleared" } }, r);
    assert.equal(r.payload.ok, true);
    assert.equal(r.payload.track.label, "Saved");
    assert.equal(r.payload.track.source, "upload");
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
});
