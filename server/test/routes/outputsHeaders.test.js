// /outputs responses carry nosniff and a sandbox CSP: files there can come from
// outside URLs (media import-url), so none may be sniffed or run as a page.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { setOutputSafetyHeaders } from "../../src/lib/mediaCache.js";

const indexSource = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "index.js"), "utf8");

test("an /outputs file is served with nosniff and a sandbox CSP", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-outputs-headers-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "note.mp3"), "<html><script>alert(1)</script></html>");

  const app = express();
  // The same order index.js uses: the header middleware, then the static files.
  app.use("/outputs", (_req, res, next) => { setOutputSafetyHeaders(res); next(); });
  app.use("/outputs", express.static(dir));
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  t.after(() => server.close());

  const r = await fetch(`http://127.0.0.1:${server.address().port}/outputs/note.mp3`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("content-security-policy"), "sandbox");
  await r.arrayBuffer();
});

test("index.js applies the headers in the /outputs middleware and the per-user fallback", () => {
  const blocks = indexSource.split('app.use("/outputs", (req, res, next) => {').slice(1);
  assert.equal(blocks.length, 2, "two /outputs middlewares");
  const [first, fallback] = blocks.map((b) => b.slice(0, b.indexOf("\n});")));
  assert.match(first, /setOutputSafetyHeaders\(res\);/);
  assert.ok(fallback.indexOf("setOutputSafetyHeaders(res);") > -1, "fallback sets them");
  assert.ok(fallback.indexOf("setOutputSafetyHeaders(res);") < fallback.indexOf("res.sendFile(hit)"), "before the file is sent");
});
