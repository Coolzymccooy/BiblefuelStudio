import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import socialRouter, { _setYoutubeRevokeImpl, _resetYoutubeRevokeImpl } from "./social.js";
import { readSocialStore, writeSocialStore } from "../lib/socialStore.js";

/**
 * Disconnect must end Google's grant, not only forget it here. Blanking the
 * local copy left the refresh token valid at Google, and the app still listed
 * under the user's Google account permissions — which is also what the
 * privacy notice promises and what Google's verification review checks.
 */

function app() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "social-yt-disc-"));
  writeSocialStore(dataDir, {
    direct: { youtube: { refreshToken: "refresh-abc", channelId: "UC1", channelTitle: "Sthill Waters", connectedAt: "2026-09-23" } },
  });
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.ctx = { userId: "u1", dataDir, outputDir: dataDir, isSuperAdmin: false }; next(); });
  a.use("/api/social", socialRouter);
  return { a, dataDir };
}

afterEach(() => _resetYoutubeRevokeImpl());

describe("POST /api/social/youtube/disconnect", () => {
  test("revokes the token with Google, then forgets it", async () => {
    const revoked = [];
    _setYoutubeRevokeImpl(async (token) => { revoked.push(token); });
    const { a, dataDir } = app();
    const res = await request(a).post("/api/social/youtube/disconnect");
    assert.equal(res.status, 200);
    assert.deepEqual(revoked, ["refresh-abc"]);
    assert.equal(res.body.revoked, true);
    const yt = readSocialStore(dataDir).direct.youtube;
    assert.equal(yt.refreshToken, "");
    assert.equal(yt.channelTitle, "");
  });

  test("still disconnects here when Google can't be reached, and says so", async () => {
    _setYoutubeRevokeImpl(async () => { throw new Error("network down"); });
    const { a, dataDir } = app();
    const res = await request(a).post("/api/social/youtube/disconnect");
    assert.equal(res.status, 200);
    assert.equal(res.body.revoked, false);
    assert.equal(readSocialStore(dataDir).direct.youtube.refreshToken, "");
  });

  test("nothing to revoke when nothing was connected", async () => {
    let calls = 0;
    _setYoutubeRevokeImpl(async () => { calls += 1; });
    const { a, dataDir } = app();
    writeSocialStore(dataDir, { direct: { youtube: { refreshToken: "" } } });
    const res = await request(a).post("/api/social/youtube/disconnect");
    assert.equal(res.status, 200);
    assert.equal(calls, 0);
  });
});
