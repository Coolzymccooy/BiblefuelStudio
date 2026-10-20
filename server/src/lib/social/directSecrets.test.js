import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { publicDirectConfig, mergeDirectSecrets } from "./directSecrets.js";

const stored = {
  youtube: { clientId: "cid", clientSecret: "operator-secret", refreshToken: "rt", channelTitle: "Sthill Waters" },
  instagram: { accessToken: "ig-token", userId: "ig-user" },
  tiktok: { accessToken: "", openId: "tt-open" },
};

describe("publicDirectConfig", () => {
  test("no secret leaves the server, only whether one is set", () => {
    const out = publicDirectConfig(stored);
    assert.doesNotMatch(JSON.stringify(out), /operator-secret|"rt"|ig-token/);
    assert.deepEqual(out.youtube, { clientId: "cid", channelTitle: "Sthill Waters", hasClientSecret: true, hasRefreshToken: true });
    assert.deepEqual(out.instagram, { userId: "ig-user", hasAccessToken: true });
    assert.deepEqual(out.tiktok, { openId: "tt-open", hasAccessToken: false });
  });

  test("an empty store still answers with every section", () => {
    assert.deepEqual(publicDirectConfig(undefined).youtube, { hasClientSecret: false, hasRefreshToken: false });
  });
});

describe("mergeDirectSecrets", () => {
  test("a blank secret from the page keeps the stored one", () => {
    const out = mergeDirectSecrets({ youtube: { clientId: "cid2", clientSecret: "", refreshToken: "" } }, stored);
    assert.equal(out.youtube.clientId, "cid2");
    assert.equal(out.youtube.clientSecret, "operator-secret");
    assert.equal(out.youtube.refreshToken, "rt");
    assert.equal(out.youtube.channelTitle, "Sthill Waters", "fields the page does not send are kept");
    assert.equal(out.instagram.accessToken, "ig-token", "a section the page left out is kept whole");
  });

  test("a new secret replaces the stored one", () => {
    const out = mergeDirectSecrets({ instagram: { accessToken: "new-token", userId: "ig-user" } }, stored);
    assert.equal(out.instagram.accessToken, "new-token");
  });

  test("the has<Secret> flags are never written back", () => {
    const out = mergeDirectSecrets({ youtube: { clientId: "cid", hasClientSecret: true } }, stored);
    assert.equal("hasClientSecret" in out.youtube, false);
  });

  test("no direct in the request keeps everything", () => {
    assert.deepEqual(mergeDirectSecrets(undefined, stored), stored);
  });
});
