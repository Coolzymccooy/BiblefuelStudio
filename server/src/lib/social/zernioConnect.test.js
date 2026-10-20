import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  _setZernioFetch, ensureZernioProfile, tiktokConnectUrl, findTikTokAccount,
  disconnectZernioAccount, tiktokAccountFor,
} from "./zernioConnect.js";
import { DATA_DIR } from "../paths.js";

const saved = { key: process.env.ZERNIO_API_KEY, account: process.env.ZERNIO_TIKTOK_ACCOUNT_ID };
let calls;

function fakeZernio(routes) {
  calls = [];
  _setZernioFetch(async (url, init = {}) => {
    const u = new URL(url);
    const key = `${init.method || "GET"} ${u.pathname}`;
    calls.push({ key, query: Object.fromEntries(u.searchParams), body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.Authorization });
    const hit = routes[key];
    if (!hit) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    const [status, body] = typeof hit === "function" ? hit(u, init) : hit;
    return new Response(JSON.stringify(body), { status });
  });
}

beforeEach(() => { process.env.ZERNIO_API_KEY = "sk_test"; process.env.ZERNIO_TIKTOK_ACCOUNT_ID = "acct_owner"; });
afterEach(() => {
  _setZernioFetch(null);
  for (const [k, v] of [["ZERNIO_API_KEY", saved.key], ["ZERNIO_TIKTOK_ACCOUNT_ID", saved.account]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

describe("ensureZernioProfile", () => {
  test("reuses the profile already made for this user", async () => {
    fakeZernio({ "GET /api/v1/profiles": [200, { profiles: [{ _id: "prof_1", externalId: "u1" }] }] });
    assert.equal(await ensureZernioProfile({ userId: "u1" }), "prof_1");
    assert.equal(calls[0].query.externalId, "u1");
    assert.equal(calls[0].auth, "Bearer sk_test");
  });

  test("makes one, named without the user's email, when there is none", async () => {
    fakeZernio({
      "GET /api/v1/profiles": [200, { profiles: [] }],
      "POST /api/v1/profiles": [201, { profile: { _id: "prof_new" } }],
    });
    assert.equal(await ensureZernioProfile({ userId: "u2" }), "prof_new");
    assert.equal(calls[1].body.externalId, "u2");
    assert.doesNotMatch(calls[1].body.name, /@/);
  });

  test("ignores another user's profile if the filter is not applied", async () => {
    fakeZernio({
      "GET /api/v1/profiles": [200, { profiles: [{ _id: "prof_other", externalId: "someone-else" }] }],
      "POST /api/v1/profiles": [201, { profile: { _id: "prof_mine" } }],
    });
    assert.equal(await ensureZernioProfile({ userId: "u3" }), "prof_mine");
  });
});

describe("tiktokConnectUrl", () => {
  test("asks Zernio for a TikTok sign-in link for the user's profile", async () => {
    fakeZernio({ "GET /api/v1/connect/tiktok": [200, { authUrl: "https://www.tiktok.com/v2/auth?x=1" }] });
    const url = await tiktokConnectUrl({ profileId: "prof_1", redirectUrl: "https://app.example/cb?bf_state=abc" });
    assert.equal(url, "https://www.tiktok.com/v2/auth?x=1");
    assert.equal(calls[0].query.profileId, "prof_1");
    assert.equal(calls[0].query.redirect_url, "https://app.example/cb?bf_state=abc");
  });

  test("refuses a link that is not https", async () => {
    fakeZernio({ "GET /api/v1/connect/tiktok": [200, { authUrl: "javascript:alert(1)" }] });
    await assert.rejects(tiktokConnectUrl({ profileId: "p", redirectUrl: "https://a/b" }));
  });
});

describe("findTikTokAccount", () => {
  test("finds the TikTok account only under the user's own profile", async () => {
    fakeZernio({ "GET /api/v1/accounts": [200, { accounts: [
      { _id: "acct_1", platform: "tiktok", username: "grace", profileId: "prof_1", isActive: true },
      { _id: "acct_2", platform: "youtube", username: "grace", profileId: "prof_1", isActive: true },
    ] }] });
    assert.deepEqual(await findTikTokAccount({ profileId: "prof_1", accountId: "acct_1" }), { accountId: "acct_1", username: "grace" });
    assert.equal(calls[0].query.profileId, "prof_1");
    assert.equal(await findTikTokAccount({ profileId: "prof_1", accountId: "acct_2" }), null, "not a TikTok account");
    assert.equal(await findTikTokAccount({ profileId: "prof_1", accountId: "acct_9" }), null, "not in this profile");
  });

  test("an account listed under another profile is refused", async () => {
    fakeZernio({ "GET /api/v1/accounts": [200, { accounts: [
      { _id: "acct_1", platform: "tiktok", username: "x", profileId: { _id: "prof_other" }, isActive: true },
    ] }] });
    assert.equal(await findTikTokAccount({ profileId: "prof_1", accountId: "acct_1" }), null);
  });
});

test("disconnectZernioAccount deletes the account at Zernio", async () => {
  fakeZernio({ "DELETE /api/v1/accounts/acct_1": [200, { ok: true }] });
  await disconnectZernioAccount("acct_1");
  assert.equal(calls[0].key, "DELETE /api/v1/accounts/acct_1");
});

describe("tiktokAccountFor", () => {
  const store = (accountId) => ({ zernio: { profileId: "prof_1", tiktok: accountId ? { accountId } : {} } });

  test("the owner posts to the server's TikTok account", () => {
    assert.equal(tiktokAccountFor({ isOwner: true }, store()), "acct_owner");
  });

  test("anyone else posts only to the account they connected", () => {
    assert.equal(tiktokAccountFor({ isOwner: false, isSuperAdmin: true }, store("acct_mine")), "acct_mine");
    assert.equal(tiktokAccountFor({ isOwner: false, isSuperAdmin: true }, store()), null);
    assert.equal(tiktokAccountFor({ isOwner: false }, store()), null);
  });

  test("a legacy owner ctx (main folder) still counts as the owner", () => {
    assert.equal(tiktokAccountFor({ isSuperAdmin: true, dataDir: DATA_DIR }, store()), "acct_owner");
  });

  test("nothing posts when the server has no Zernio key", () => {
    delete process.env.ZERNIO_API_KEY;
    assert.equal(tiktokAccountFor({ isOwner: true }, store()), null);
    assert.equal(tiktokAccountFor({ isOwner: false }, store("acct_mine")), null);
  });
});
