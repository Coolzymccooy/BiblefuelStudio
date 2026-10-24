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

// ---- R41: agents remove only schedules agents made ----

const SCHEDULE_LIST = {
  ok: true,
  schedules: [
    { id: "sch_agent", name: "Agent made", createdByAgentKeyId: "ak_other" },
    { id: "sch_web", name: "Made in the app" },
  ],
};

test("schedules remove deletes a schedule an agent made (any of the user's keys)", async () => {
  const { ctx, calls, charges } = ctxWith({
    "GET /api/social/schedules": SCHEDULE_LIST,
    "DELETE /api/social/schedules/sch_agent": { ok: true },
  });
  const result = await byName.schedules.handler(ctx, { action: "remove", id: "sch_agent" });
  assert.deepEqual(result.structuredContent, { removed: "sch_agent" });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ["GET /api/social/schedules", "DELETE /api/social/schedules/sch_agent"]);
  assert.deepEqual(charges, []);
});

test("schedules remove refuses a schedule made in the app with NOT_AGENT_SCHEDULE and deletes nothing", async () => {
  const { ctx, calls } = ctxWith({ "GET /api/social/schedules": SCHEDULE_LIST });
  const result = await byName.schedules.handler(ctx, { action: "remove", id: "sch_web" });
  assert.equal(result.structuredContent.error, "NOT_AGENT_SCHEDULE");
  assert.equal(calls.some((c) => c.method === "DELETE"), false);
});

test("schedules remove of an unknown id is SCHEDULE_NOT_FOUND and deletes nothing", async () => {
  const { ctx, calls } = ctxWith({ "GET /api/social/schedules": SCHEDULE_LIST });
  const result = await byName.schedules.handler(ctx, { action: "remove", id: "sch_gone" });
  assert.equal(result.structuredContent.error, "SCHEDULE_NOT_FOUND");
  assert.equal(calls.some((c) => c.method === "DELETE"), false);
});

test("the schedules description says agents remove only schedules agents made", () => {
  assert.match(byName.schedules.description, /only schedules an agent created/i);
  assert.match(byName.schedules.description, /NOT_AGENT_SCHEDULE/);
});
