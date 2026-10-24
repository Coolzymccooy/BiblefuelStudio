import { describe, test, after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import jwt from "jsonwebtoken";

/**
 * Connect TikTok: other admins connect their OWN TikTok through the
 * operator's Zernio account, each under their own Zernio profile, and only
 * ever post to that account.
 */

const SECRET = "test_secret_for_tiktok_state";
const OWNER_EMAIL = "owner@example.com";
const ADMIN_EMAIL = "admin2@example.com";

// paths.js reads DATA_DIR at load, so the environment comes first.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tiktok-connect-"));
process.env.DATA_DIR = path.join(tmpRoot, "data");
process.env.OUTPUT_DIR = path.join(tmpRoot, "outputs");
process.env.SUPER_ADMIN_EMAIL = `${OWNER_EMAIL},${ADMIN_EMAIL}`;
delete process.env.SUPER_ADMIN_USER_ID;
delete process.env.OWNER_EMAIL;
process.env.MULTITENANT = "true";
process.env.JWT_SECRET = SECRET;
process.env.PUBLIC_BASE_URL = "https://example.test";
process.env.ZERNIO_API_KEY = "sk_test_server_key_000";
process.env.ZERNIO_TIKTOK_ACCOUNT_ID = "acct_owner";

const { withUserScope } = await import("../middleware/userScope.js");
const socialModule = await import("./social.js");
const socialRouter = socialModule.default;
const { tiktokConnectCallback, _resetOwnKeyLimit } = socialModule;
const { _setZernioFetch } = await import("../lib/social/zernioConnect.js");
const { readSocialStore, writeSocialStore } = await import("../lib/socialStore.js");
const { resolveScopeDirs } = await import("../lib/paths.js");
const { signOAuthState, requireAuth } = await import("../auth.js");

after(() => { fs.rmSync(tmpRoot, { recursive: true, force: true }); });
afterEach(() => _setZernioFetch(null));

const owner = { sub: "owner-sub", email: OWNER_EMAIL };
const admin = { sub: "admin2-sub", email: ADMIN_EMAIL };
const regular = { sub: "user-sub", email: "user@example.com" };

function app(user) {
  const a = express();
  a.use(express.json());
  a.get("/api/social/tiktok/callback", tiktokConnectCallback);
  a.use((req, _res, next) => { req.user = user; next(); });
  a.use(withUserScope);
  a.use("/api/social", socialRouter);
  return a;
}

let calls = [];
function fakeZernio(routes) {
  calls = [];
  _setZernioFetch(async (url, init = {}) => {
    const u = new URL(url);
    const key = `${init.method || "GET"} ${u.pathname}`;
    calls.push({ key, query: Object.fromEntries(u.searchParams), auth: init.headers?.Authorization });
    const hit = routes[key];
    if (!hit) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(hit[1]), { status: hit[0] });
  });
}

const dirOf = (user) => resolveScopeDirs(user).dataDir;
const NONCE = "n0nce";
const state = (user, profileId, opts = {}) => {
  const claims = { sub: user.sub, email: user.email, purpose: "tiktok_connect", pid: profileId, nonce: NONCE };
  return opts.secret
    ? jwt.sign(claims, opts.secret, { expiresIn: opts.expiresIn || "15m" })
    : signOAuthState(claims, opts.expiresIn || "15m");
};
// The callback, as the browser that started the connect makes it.
const callback = (query, cookie = `bf_tiktok_nonce=${NONCE}`) => {
  const r = request(app(null)).get(`/api/social/tiktok/callback?${query}`);
  return cookie ? r.set("Cookie", cookie) : r;
};

describe("GET /tiktok/status", () => {
  test("the owner posts through the server's account", async () => {
    const res = await request(app(owner)).get("/api/social/tiktok/status").expect(200);
    assert.equal(res.body.connected, true);
    assert.equal(res.body.source, "server");
  });

  test("another admin is not connected yet but may connect", async () => {
    const res = await request(app(admin)).get("/api/social/tiktok/status").expect(200);
    assert.equal(res.body.connected, false);
    assert.equal(res.body.canConnect, true);
  });

  test("a regular user may not connect through the operator's Zernio", async () => {
    const res = await request(app(regular)).get("/api/social/tiktok/status").expect(200);
    assert.equal(res.body.canConnect, false);
  });
});

describe("POST /tiktok/connect", () => {
  test("a regular user is refused, so they cannot add to the operator's Zernio bill", async () => {
    const res = await request(app(regular)).post("/api/social/tiktok/connect").expect(403);
    assert.match(res.body.error, /admin/i);
  });

  test("an admin gets a TikTok sign-in link for their own Zernio profile", async () => {
    fakeZernio({
      "GET /api/v1/profiles": [200, { profiles: [] }],
      "POST /api/v1/profiles": [201, { profile: { _id: "prof_admin2" } }],
      "GET /api/v1/connect/tiktok": [200, { authUrl: "https://www.tiktok.com/v2/auth?x=1" }],
    });
    const res = await request(app(admin)).post("/api/social/tiktok/connect").expect(200);
    assert.equal(res.body.authUrl, "https://www.tiktok.com/v2/auth?x=1");
    const connect = calls.find((c) => c.key === "GET /api/v1/connect/tiktok");
    assert.equal(connect.query.profileId, "prof_admin2");
    assert.match(connect.query.redirect_url, /^https:\/\/example\.test\/api\/social\/tiktok\/callback\?bf_state=/);
    assert.equal(readSocialStore(dirOf(admin)).zernio.profileId, "prof_admin2");
    assert.match(String(res.headers["set-cookie"] || ""), /bf_tiktok_nonce=[0-9a-f]{32};.*HttpOnly/i);
  });

  test("an admin with a TikTok already connected must disconnect first", async () => {
    writeSocialStore(dirOf(admin), { ...readSocialStore(dirOf(admin)), zernio: { profileId: "prof_admin2", tiktok: { accountId: "acct_a2" } } });
    const res = await request(app(admin)).post("/api/social/tiktok/connect").expect(409);
    assert.match(res.body.error, /Disconnect/);
    writeSocialStore(dirOf(admin), { ...readSocialStore(dirOf(admin)), zernio: { profileId: "prof_admin2" } });
  });

  test("the sign-in state is never accepted as a login", async () => {
    const run = (token) => new Promise((resolve) => {
      const res = { status(code) { this.code = code; return this; }, json() { resolve(this.code); } };
      requireAuth({ headers: { authorization: `Bearer ${token}` }, query: {} }, res, () => resolve(200));
    });
    assert.equal(await run(state(admin, "prof_admin2")), 401, "a state signed with the OAuth-state key");
    assert.equal(await run(state(admin, "prof_admin2", { secret: SECRET })), 401, "a purpose token signed with JWT_SECRET");
    assert.equal(await run(jwt.sign({ sub: admin.sub, email: admin.email }, SECRET)), 200, "a real login still works");
  });

  test("the owner is told their TikTok comes from the server settings", async () => {
    const res = await request(app(owner)).post("/api/social/tiktok/connect").expect(400);
    assert.match(res.body.error, /server settings/i);
  });
});

describe("GET /tiktok/callback", () => {
  const seedProfile = (user, profileId) => {
    const store = readSocialStore(dirOf(user));
    writeSocialStore(dirOf(user), { ...store, zernio: { profileId } });
  };

  test("saves the account once Zernio lists it under the admin's profile", async () => {
    seedProfile(admin, "prof_admin2");
    fakeZernio({ "GET /api/v1/accounts": [200, { accounts: [{ _id: "acct_a2", platform: "tiktok", username: "graceposts", profileId: "prof_admin2" }] }] });
    const res = await callback(`bf_state=${state(admin, "prof_admin2")}&connected=tiktok&accountId=acct_a2&profileId=prof_admin2`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, "/app/settings?tiktok=connected");
    assert.deepEqual(
      { accountId: readSocialStore(dirOf(admin)).zernio.tiktok.accountId, username: readSocialStore(dirOf(admin)).zernio.tiktok.username },
      { accountId: "acct_a2", username: "graceposts" },
    );
  });

  test("an account that is not under the admin's profile is refused", async () => {
    seedProfile(admin, "prof_admin2");
    writeSocialStore(dirOf(admin), { ...readSocialStore(dirOf(admin)), zernio: { profileId: "prof_admin2" } });
    fakeZernio({ "GET /api/v1/accounts": [200, { accounts: [] }] });
    const res = await callback(`bf_state=${state(admin, "prof_admin2")}&accountId=acct_owner`);
    assert.equal(res.headers.location, "/app/settings?tiktok_error=not_found");
    assert.equal(readSocialStore(dirOf(admin)).zernio.tiktok?.accountId || "", "");
  });

  test("the callback must come from the browser that started the connect", async () => {
    seedProfile(admin, "prof_admin2");
    fakeZernio({ "GET /api/v1/accounts": [200, { accounts: [{ _id: "acct_a2", platform: "tiktok", profileId: "prof_admin2" }] }] });
    const none = await callback(`bf_state=${state(admin, "prof_admin2")}&accountId=acct_a2`, null);
    assert.equal(none.headers.location, "/app/settings?tiktok_error=expired");
    const other = await callback(`bf_state=${state(admin, "prof_admin2")}&accountId=acct_a2`, "bf_tiktok_nonce=someone-else");
    assert.equal(other.headers.location, "/app/settings?tiktok_error=expired");
    assert.equal(readSocialStore(dirOf(admin)).zernio.tiktok?.accountId || "", "");
  });

  test("an account Zernio lists without a profile, or the server's own account, is refused", async () => {
    seedProfile(admin, "prof_admin2");
    fakeZernio({ "GET /api/v1/accounts": [200, { accounts: [
      { _id: "acct_loose", platform: "tiktok" },
      { _id: "acct_owner", platform: "tiktok", profileId: "prof_admin2" },
    ] }] });
    const loose = await callback(`bf_state=${state(admin, "prof_admin2")}&accountId=acct_loose`);
    assert.equal(loose.headers.location, "/app/settings?tiktok_error=not_found");
    const ownerAcct = await callback(`bf_state=${state(admin, "prof_admin2")}&accountId=acct_owner`);
    assert.equal(ownerAcct.headers.location, "/app/settings?tiktok_error=not_found");
    assert.equal(readSocialStore(dirOf(admin)).zernio.tiktok?.accountId || "", "");
  });

  test("a forged or expired state is refused", async () => {
    const forged = await callback(`bf_state=${state(admin, "prof_admin2", { secret: SECRET })}&accountId=acct_a2`);
    assert.equal(forged.headers.location, "/app/settings?tiktok_error=expired");
    const old = await callback(`bf_state=${state(admin, "prof_admin2", { expiresIn: "-1s" })}&accountId=acct_a2`);
    assert.equal(old.headers.location, "/app/settings?tiktok_error=expired");
  });

  test("a state issued for a different profile is refused", async () => {
    seedProfile(admin, "prof_admin2");
    const res = await callback(`bf_state=${state(admin, "prof_someone_else")}&accountId=acct_a2`);
    assert.equal(res.headers.location, "/app/settings?tiktok_error=expired");
  });

  test("a cancelled TikTok sign-in goes back to Settings without echoing the error text", async () => {
    const res = await callback(`bf_state=${state(admin, "prof_admin2")}&error=access_denied&error_message=%3Cscript%3E`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, "/app/settings?tiktok_error=cancelled");
  });
});

describe("posting and disconnecting", () => {
  test("a connected admin's TikTok counts as an auto-publish destination", async () => {
    writeSocialStore(dirOf(admin), { ...readSocialStore(dirOf(admin)), zernio: { profileId: "prof_admin2", tiktok: { accountId: "acct_a2", username: "graceposts" } } });
    const status = await request(app(admin)).get("/api/social/auto-publish-status").expect(200);
    assert.ok(status.body.destinations.includes("zernio"));
    const hooks = await request(app(admin)).get("/api/social/webhooks").expect(200);
    assert.equal(hooks.body.tiktokDirect, true);
  });

  test("Save all keeps the TikTok connection and the Postiz settings", async () => {
    const dir = dirOf(admin);
    writeSocialStore(dir, { ...readSocialStore(dir), zernio: { profileId: "prof_admin2", tiktok: { accountId: "acct_a2", username: "g" } }, postiz: { apiKey: "pz_key", integrations: [] } });
    const before = readSocialStore(dir).postiz;
    await request(app(admin)).post("/api/social/config").send({ webhooks: [], schedules: [], direct: {} }).expect(200);
    assert.equal(readSocialStore(dir).zernio.tiktok.accountId, "acct_a2");
    assert.deepEqual(readSocialStore(dir).postiz, before);
  });

  test("disconnect removes the account at Zernio and here", async () => {
    writeSocialStore(dirOf(admin), { ...readSocialStore(dirOf(admin)), zernio: { profileId: "prof_admin2", tiktok: { accountId: "acct_a2", username: "g" } } });
    fakeZernio({ "DELETE /api/v1/accounts/acct_a2": [200, { ok: true }] });
    await request(app(admin)).post("/api/social/tiktok/disconnect").expect(200);
    assert.ok(calls.some((c) => c.key === "DELETE /api/v1/accounts/acct_a2"));
    assert.equal(readSocialStore(dirOf(admin)).zernio.tiktok?.accountId || "", "");
    assert.equal(readSocialStore(dirOf(admin)).zernio.profileId, "prof_admin2", "the profile is kept for a reconnect");
  });

  test("when Zernio does not confirm the disconnect, the account is kept so it can be retried", async () => {
    writeSocialStore(dirOf(admin), { ...readSocialStore(dirOf(admin)), zernio: { profileId: "prof_admin2", tiktok: { accountId: "acct_a2", username: "g" } } });
    fakeZernio({ "DELETE /api/v1/accounts/acct_a2": [500, { error: "boom" }] });
    const res = await request(app(admin)).post("/api/social/tiktok/disconnect").expect(502);
    assert.match(res.body.error, /still connected/);
    assert.equal(readSocialStore(dirOf(admin)).zernio.tiktok.accountId, "acct_a2");
  });

  test("an account already gone at Zernio is cleared here too", async () => {
    writeSocialStore(dirOf(admin), { ...readSocialStore(dirOf(admin)), zernio: { profileId: "prof_admin2", tiktok: { accountId: "acct_a2", username: "g" } } });
    fakeZernio({ "DELETE /api/v1/accounts/acct_a2": [404, { error: "Not found" }] });
    await request(app(admin)).post("/api/social/tiktok/disconnect").expect(200);
    assert.equal(readSocialStore(dirOf(admin)).zernio.tiktok?.accountId || "", "");
  });
});

describe("POST /post destination=tiktok", () => {
  let sent = [];
  // Zernio's posts endpoint. Anything else (a Make webhook) is recorded and refused.
  function stubPosts(answer) {
    sent = [];
    _setZernioFetch(async (url, init = {}) => {
      sent.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.Authorization });
      if (String(url) === "https://zernio.com/api/v1/posts") return new Response(JSON.stringify(answer[1]), { status: answer[0] });
      return new Response("{}", { status: 404 });
    });
  }
  const connectAdmin = () => writeSocialStore(dirOf(admin), {
    ...readSocialStore(dirOf(admin)),
    zernio: { profileId: "prof_admin2", tiktok: { accountId: "acct_a2", username: "graceposts" } },
    // A local port nothing listens on: were it fired, the attempt is recorded below and nothing leaves the machine.
    webhooks: [{ id: "wh1", name: "Make", url: "http://127.0.0.1:9/make", enabled: true }],
  });
  const published = { post: { _id: "post_1", status: "published", platforms: [{ platform: "tiktok", status: "published" }] } };

  test("posts the video straight to the caller's own TikTok, now, and not to their Make webhook", async () => {
    connectAdmin();
    stubPosts([200, published]);
    const res = await request(app(admin)).post("/api/social/post")
      .send({ destination: "tiktok", caption: "The Lost Lamb\nLuke 15:4", title: "The Lost Lamb", videoUrl: "/outputs/cartoons/c1/film.mp4" })
      .expect(200);
    assert.equal(res.body.ok, true);
    assert.deepEqual(res.body.results, [{ destination: "tiktok", ok: true, error: "", draft: false }]);
    assert.equal(sent.length, 1, "only Zernio is called");
    const hook = readSocialStore(dirOf(admin)).webhooks.find((w) => w.id === "wh1");
    assert.equal(hook.lastSuccessAt || hook.lastFailureAt || "", "", "the Make webhook is not fired");
    assert.equal(sent[0].url, "https://zernio.com/api/v1/posts");
    assert.equal(sent[0].auth, "Bearer sk_test_server_key_000");
    assert.equal(sent[0].body.publishNow, true);
    assert.equal(sent[0].body.platforms[0].accountId, "acct_a2");
    assert.match(sent[0].body.mediaItems[0].url, /^https?:\/\/[^/]+\/outputs\/cartoons\/c1\/film\.mp4$/);
  });

  test("a caller with no TikTok connected is told to connect it, and nothing is sent", async () => {
    writeSocialStore(dirOf(regular), { ...readSocialStore(dirOf(regular)), zernio: {} });
    stubPosts([200, published]);
    const res = await request(app(regular)).post("/api/social/post")
      .send({ destination: "tiktok", caption: "c", videoUrl: "/outputs/a.mp4" })
      .expect(400);
    assert.match(res.body.error, /Connect TikTok in Settings/);
    assert.equal(sent.length, 0);
  });

  test("a post TikTok rejects comes back as an error with Zernio's reason", async () => {
    connectAdmin();
    stubPosts([207, { post: { _id: "post_2", status: "failed", platforms: [{ platform: "tiktok", status: "failed", errorMessage: "Video is too short" }] } }]);
    const res = await request(app(admin)).post("/api/social/post")
      .send({ destination: "tiktok", caption: "c", videoUrl: "/outputs/a.mp4" })
      .expect(400);
    assert.equal(res.body.ok, false);
    assert.match(res.body.error, /Video is too short/);
  });
});

describe("bring your own Zernio key", () => {
  const OWN_KEY = "sk_own_user_key_1234abcd";
  const reset = (user) => writeSocialStore(dirOf(user), { ...readSocialStore(dirOf(user)), zernio: {} });
  beforeEach(() => _resetOwnKeyLimit(regular.sub));

  test("a regular user saves their own key; a single TikTok on it is picked for them", async () => {
    reset(regular);
    fakeZernio({ "GET /api/v1/accounts": [200, { accounts: [{ _id: "acct_mine", platform: "tiktok", username: "mytok" }, { _id: "acct_ig", platform: "instagram" }] }] });
    const res = await request(app(regular)).post("/api/social/tiktok/own-key").send({ apiKey: OWN_KEY }).expect(200);
    assert.deepEqual(res.body.accounts, [{ accountId: "acct_mine", username: "mytok" }]);
    assert.equal(res.body.selected, "acct_mine");
    assert.equal(calls[0].auth, `Bearer ${OWN_KEY}`, "their key, not the server's");

    const status = await request(app(regular)).get("/api/social/tiktok/status").expect(200);
    assert.equal(status.body.connected, true);
    assert.equal(status.body.source, "own_key");
    assert.equal(status.body.username, "mytok");
    assert.equal(status.body.ownKey.hint, "abcd");
    assert.doesNotMatch(JSON.stringify(status.body), new RegExp(OWN_KEY), "the key is never sent back");

    const auto = await request(app(regular)).get("/api/social/auto-publish-status").expect(200);
    assert.ok(auto.body.destinations.includes("zernio"));
  });

  test("a key Zernio refuses is not saved", async () => {
    reset(regular);
    fakeZernio({ "GET /api/v1/accounts": [401, { error: "Invalid API key" }] });
    const res = await request(app(regular)).post("/api/social/tiktok/own-key").send({ apiKey: OWN_KEY }).expect(400);
    assert.match(res.body.error, /did not accept/);
    assert.deepEqual(readSocialStore(dirOf(regular)).zernio.own, {});
  });

  test("junk is refused before anything is sent to Zernio", async () => {
    fakeZernio({});
    await request(app(regular)).post("/api/social/tiktok/own-key").send({ apiKey: "not a key\nX-Evil: 1" }).expect(400);
    assert.equal(calls.length, 0);
  });

  test("the server's own key cannot be pasted in as a user's key", async () => {
    fakeZernio({});
    const res = await request(app(regular)).post("/api/social/tiktok/own-key").send({ apiKey: "sk_test_server_key_000" }).expect(400);
    assert.equal(calls.length, 0);
    assert.match(res.body.error, /server's own Zernio key/);
  });

  test("with several TikToks the user picks one, and only one that is on their key", async () => {
    reset(regular);
    const two = { accounts: [{ _id: "acct_1", platform: "tiktok", username: "one" }, { _id: "acct_2", platform: "tiktok", username: "two" }] };
    fakeZernio({ "GET /api/v1/accounts": [200, two] });
    const saved = await request(app(regular)).post("/api/social/tiktok/own-key").send({ apiKey: OWN_KEY }).expect(200);
    assert.equal(saved.body.selected, "");
    const before = await request(app(regular)).get("/api/social/tiktok/status").expect(200);
    assert.equal(before.body.connected, false, "no account chosen yet");

    await request(app(regular)).post("/api/social/tiktok/own-account").send({ accountId: "acct_owner" }).expect(400);
    const pick = await request(app(regular)).post("/api/social/tiktok/own-account").send({ accountId: "acct_2" }).expect(200);
    assert.equal(pick.body.username, "two");
    assert.equal(readSocialStore(dirOf(regular)).zernio.own.accountId, "acct_2");
  });

  test("a key that can see the server's own TikTok is refused", async () => {
    reset(regular);
    fakeZernio({ "GET /api/v1/accounts": [200, { accounts: [{ _id: "acct_owner", platform: "tiktok", username: "operator" }] }] });
    const res = await request(app(regular)).post("/api/social/tiktok/own-key").send({ apiKey: OWN_KEY }).expect(400);
    assert.match(res.body.error, /server's Zernio account/);
    assert.deepEqual(readSocialStore(dirOf(regular)).zernio.own, {});
  });

  test("a read-only key is refused, since every post would fail", async () => {
    reset(regular);
    fakeZernio({
      "GET /api/v1/accounts": [200, { accounts: [{ _id: "acct_mine", platform: "tiktok", username: "mytok" }] }],
      "GET /api/v1/auth/verify": [200, { valid: true, permission: "read" }],
    });
    const res = await request(app(regular)).post("/api/social/tiktok/own-key").send({ apiKey: OWN_KEY }).expect(400);
    assert.match(res.body.error, /read-only/);
    assert.deepEqual(readSocialStore(dirOf(regular)).zernio.own, {});
  });

  test("pasting keys is rate limited per user", async () => {
    fakeZernio({ "GET /api/v1/accounts": [401, { error: "Invalid API key" }] });
    for (let i = 0; i < 6; i += 1) {
      await request(app(regular)).post("/api/social/tiktok/own-key").send({ apiKey: OWN_KEY }).expect(400);
    }
    const blocked = await request(app(regular)).post("/api/social/tiktok/own-key").send({ apiKey: OWN_KEY }).expect(429);
    assert.match(blocked.body.error, /Too many tries/);
    await request(app(admin)).get("/api/social/tiktok/status").expect(200);
  });

  test("removing the key forgets it here", async () => {
    writeSocialStore(dirOf(regular), { ...readSocialStore(dirOf(regular)), zernio: { own: { apiKey: OWN_KEY, accountId: "acct_mine" } } });
    await request(app(regular)).post("/api/social/tiktok/own-key/remove").expect(200);
    assert.deepEqual(readSocialStore(dirOf(regular)).zernio.own, {});
    const status = await request(app(regular)).get("/api/social/tiktok/status").expect(200);
    assert.equal(status.body.connected, false);
    assert.equal(status.body.ownKey, null);
  });

  test("Save all keeps the user's own key", async () => {
    writeSocialStore(dirOf(regular), { ...readSocialStore(dirOf(regular)), zernio: { own: { apiKey: OWN_KEY, accountId: "acct_mine" } } });
    await request(app(regular)).post("/api/social/config").send({ webhooks: [], schedules: [], direct: {} }).expect(200);
    assert.equal(readSocialStore(dirOf(regular)).zernio.own.apiKey, OWN_KEY);
  });
});
