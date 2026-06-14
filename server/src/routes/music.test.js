import { test, describe } from "node:test";
import assert from "node:assert/strict";
import musicRouter from "./music.js";

function handlerFor(method, routePath) {
  const layer = musicRouter.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
  if (!layer) throw new Error(`no handler for ${method} ${routePath}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}
function res() {
  return { payload: null, statusCode: 200, status(c) { this.statusCode = c; return this; }, json(p) { this.payload = p; return this; } };
}

describe("music route", () => {
  test("GET /library returns the 23 tracks", () => {
    const r = res();
    handlerFor("get", "/library")({}, r);
    assert.equal(r.payload.ok, true);
    assert.equal(r.payload.tracks.length, 23);
    assert.match(r.payload.tracks[0].previewUrl, /^\/music\//);
  });
});
