import { describe, test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import jwt from "jsonwebtoken";

/**
 * The OAuth callback and the authenticated status route MUST agree on which
 * directory holds the user's social.json.
 *
 * They resolve it independently — `withUserScope` for the authenticated
 * request, `dataDirFor` inside the callback, because Google's redirect
 * carries no JWT. When the two disagree, the refresh token is written
 * somewhere the status route never reads and YouTube shows "Not connected"
 * forever, with no error anywhere: consent succeeded, the token exchange
 * succeeded, the file was written. It just went to the wrong path.
 *
 * That is exactly what a super-admin identified by SUPER_ADMIN_EMAIL hit:
 * the signed state token carried only `sub`, so `isSuperAdmin` was false in
 * the callback and true everywhere else.
 */

const SECRET = "test_secret_for_oauth_state";
const ADMIN_EMAIL = "admin@example.com";
const ADMIN_SUB = "admin-sub-1";

// paths.js resolves DATA_DIR at module load and userScope.js imports it
// transitively, so the environment has to be in place BEFORE either is
// loaded — hence one fixed root for the file and a top-level await import
// rather than per-test setup.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yt-oauth-"));
process.env.DATA_DIR = path.join(tmpRoot, "data");
process.env.OUTPUT_DIR = path.join(tmpRoot, "outputs");
// The production shape: the admin is known by EMAIL, not by user id.
process.env.SUPER_ADMIN_EMAIL = ADMIN_EMAIL;
delete process.env.SUPER_ADMIN_USER_ID;
process.env.MULTITENANT = "true";
process.env.JWT_SECRET = SECRET;
process.env.YOUTUBE_CLIENT_ID = "test-client-id";
process.env.YOUTUBE_CLIENT_SECRET = "test-client-secret";
process.env.PUBLIC_BASE_URL = "https://example.test";

const { dataDirFor, resolveScopeDirs } = await import("../lib/paths.js");
const { withUserScope } = await import("../middleware/userScope.js");
const socialRouter = (await import("./social.js")).default;

after(() => { fs.rmSync(tmpRoot, { recursive: true, force: true }); });

/** The dataDir an authenticated request resolves for this user. */
async function authedDataDir(user) {
  const app = express();
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use(withUserScope);
  app.get("/whoami", (req, res) => res.json({ dataDir: req.ctx.dataDir }));
  const res = await request(app).get("/whoami");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.dataDir;
}

/** The state token the connect route actually issues for this user. */
async function stateFromConnect(ctx) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.ctx = ctx; next(); });
  app.use("/api/social", socialRouter);
  const res = await request(app).get("/api/social/youtube/connect");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const state = new URL(res.body.authUrl).searchParams.get("state");
  assert.ok(state, "connect must issue a state token");
  return jwt.verify(state, SECRET);
}

describe("YouTube OAuth callback / status agree on the user's data directory", () => {
  test("a super-admin known by email resolves the SAME dataDir in the callback as when authenticated", async () => {
    const expected = await authedDataDir({ sub: ADMIN_SUB, email: ADMIN_EMAIL });

    // Replay exactly what the callback does: verify the state it was issued,
    // then resolve the directory from the claims inside it.
    const decoded = await stateFromConnect({
      userId: ADMIN_SUB, email: ADMIN_EMAIL, dataDir: tmpRoot, outputDir: tmpRoot,
    });
    const callbackDataDir = dataDirFor({ sub: String(decoded.sub), email: decoded.email });

    assert.equal(
      callbackDataDir,
      expected,
      "the callback writes the refresh token to a directory the status route never reads",
    );
  });

  test("the connect route signs the email into state, so the callback can resolve the same identity", async () => {
    const decoded = await stateFromConnect({
      userId: ADMIN_SUB, email: ADMIN_EMAIL, dataDir: tmpRoot, outputDir: tmpRoot,
    });
    assert.equal(decoded.sub, ADMIN_SUB);
    assert.equal(decoded.purpose, "yt_oauth_connect");
    assert.equal(
      decoded.email,
      ADMIN_EMAIL,
      "without the email the callback cannot tell a super-admin from a regular user",
    );
  });

  test("a regular (non-admin) user is unaffected — same dir either way", async () => {
    // This is why the bug only ever bit the operator: a non-admin lands in
    // the same per-user directory whether or not the email is present.
    const expected = await authedDataDir({ sub: "regular-1", email: "someone@example.com" });
    assert.equal(dataDirFor({ sub: "regular-1", email: undefined }), expected);
  });

  test("single-tenant mode keeps the two paths together for EVERY user", async () => {
    // MULTITENANT=false routes everyone to DATA_DIR in withUserScope. A
    // callback that resolved paths without knowing that flag would send every
    // user's token to DATA_DIR/users/<sub> — the same defect as above, but
    // for the whole user base rather than just the admin.
    const prev = process.env.MULTITENANT;
    process.env.MULTITENANT = "false";
    try {
      const expected = await authedDataDir({ sub: "regular-2", email: "nobody@example.com" });
      const viaResolver = resolveScopeDirs({ sub: "regular-2", email: "nobody@example.com" }).dataDir;
      assert.equal(viaResolver, expected, "the resolver must honour the tenancy flag too");
    } finally {
      if (prev === undefined) delete process.env.MULTITENANT; else process.env.MULTITENANT = prev;
    }
  });

  test("the resolver matches withUserScope for an admin and a regular user alike", async () => {
    for (const user of [
      { sub: ADMIN_SUB, email: ADMIN_EMAIL },
      { sub: "regular-3", email: "third@example.com" },
    ]) {
      const expected = await authedDataDir(user);
      assert.equal(resolveScopeDirs(user).dataDir, expected, `mismatch for ${user.sub}`);
    }
  });
});
