import { test, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import { spaFallback } from "./spaFallback.js";

function app() {
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), "spa-"));
  fs.writeFileSync(path.join(publicDir, "index.html"), "<html>app</html>");
  const a = express();
  a.get("*", spaFallback(publicDir));
  return a;
}

describe("spaFallback", () => {
  test("a missing asset is a real 404, never index.html", async () => {
    const res = await request(app()).get("/assets/index-gone.js");
    assert.equal(res.status, 404);
    assert.doesNotMatch(res.text, /<html>/);
  });

  test("a missing asset's 404 must not be cached", async () => {
    // During a deploy the new index.html can be served while the old
    // container answers for its assets. Cloudflare cached that 404 (with a
    // four-hour browser TTL), so the new bundle 404'd after it existed.
    const res = await request(app()).get("/assets/index-new.js");
    assert.match(res.headers["cache-control"], /no-store/);
  });

  test("an app route gets index.html, always revalidated", async () => {
    const res = await request(app()).get("/app/ambient");
    assert.equal(res.status, 200);
    assert.match(res.text, /<html>app<\/html>/);
    assert.match(res.headers["cache-control"], /no-cache/);
  });
});
