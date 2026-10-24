import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakeMcpCtx } from "../../../test/helpers/fakeMcpCtx.js";
import { _setScopeForTests } from "../mediaPath.js";
import publishTools from "./publish.js";

// Final-review rules for the publishing tools: a joined upload costs no second publish (R37),
// and agents remove only schedules agents made (R41).

const byName = Object.fromEntries(publishTools.map((t) => [t.name, t]));
const CONSENT = { agentKey: { id: "ak_me", publishAllowed: true } };
const dirs = [];

after(() => {
  _setScopeForTests(null);
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

function mediaWith(...names) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "publish-rules-"));
  dirs.push(dir);
  for (const name of names) fs.writeFileSync(path.join(dir, name), "x");
  _setScopeForTests(async () => ({ outputDir: dir, sharedDir: path.join(dir, "none") }));
  return dir;
}

function ctxWith(responses) {
  const fake = fakeMcpCtx(responses);
  return { ...fake, ctx: { ...fake.ctx, ...CONSENT } };
}

for (const joined of [true, false]) {
  test(`publish_youtube ${joined ? "gives back" : "keeps"} its publish when the upload ${joined ? "joined one already running" : "is new"}`, async () => {
    const dir = mediaWith("clip.mp4");
    const { ctx, charges, refunds } = ctxWith({ "POST /api/social/youtube/publish": { ok: true, jobId: "pub_1", joined } });
    const result = await byName.publish_youtube.handler(ctx, { videoPath: path.join(dir, "clip.mp4"), title: "Psalm 23" });
    assert.notEqual(result.isError, true, result.content?.[0]?.text);
    assert.equal(result.structuredContent.joined, joined);
    assert.deepEqual(charges, [{ bucket: "publishes", amount: 1 }]);
    assert.deepEqual(refunds, joined ? [{ bucket: "publishes", amount: 1 }] : []);
  });
}
