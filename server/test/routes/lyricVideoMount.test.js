// How Song mode is wired into the app: the caption fonts are served, and the
// router is mounted behind the capability gate with no router-level quota.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { FONT_DIR } from "../../src/lib/videoFilters.js";

const indexSource = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "index.js"), "utf8");

async function withApp(fn) {
  const app = express();
  // Exactly the line index.js carries (asserted against its source below).
  app.use("/caption-fonts", express.static(FONT_DIR, { maxAge: "7d" }));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  try { await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
}

test("GET /caption-fonts/DejaVuSans.ttf serves the font", async () => {
  await withApp(async (base) => {
    const r = await fetch(`${base}/caption-fonts/DejaVuSans.ttf`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /font|ttf|octet-stream/i);
    assert.match(r.headers.get("cache-control"), /max-age=604800/);
    assert.ok((await r.arrayBuffer()).byteLength > 10_000);
    assert.equal((await fetch(`${base}/caption-fonts/nope.ttf`)).status, 404);
    assert.equal((await fetch(`${base}/caption-fonts/..%2Findex.js`)).status, 404, "stays inside the fonts folder");
  });
});

test("index.js mounts the fonts and the router the way this test assumes", () => {
  assert.ok(indexSource.includes('app.use("/caption-fonts", express.static(FONT_DIR, { maxAge: "7d" }));'));
  assert.match(indexSource, /import \{ FONT_DIR \} from "\.\/src\/lib\/videoFilters\.js";/);
  const mount = indexSource.split("\n").find((l) => l.startsWith('app.use("/api/lyric-video"'));
  assert.ok(mount, "router is mounted");
  assert.match(mount, /requireAuth,\s*withUserScope,\s*requireVerifiedEmail,\s*featureGate\("lyric\.video"\),\s*lyricVideoRouter\)/);
  assert.doesNotMatch(mount, /quota\(/, "no router-level quota (R26)");
  // The fonts are public static files: they come before the auth-protected API routes.
  assert.ok(indexSource.indexOf('"/caption-fonts"') < indexSource.indexOf('app.use("/api/lyric-video"'));
});

test("the page's CSP allows same-origin font and worker fetches", () => {
  assert.match(indexSource, /fontSrc: \["'self'"/);
  assert.match(indexSource, /connectSrc: \["'self'"/);
  assert.match(indexSource, /workerSrc: \["'self'", "blob:"\]/);
});
