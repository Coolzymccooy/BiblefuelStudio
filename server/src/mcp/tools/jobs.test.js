import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startTestApp, mcpClient } from "../../../test/helpers/mcpTestApp.js";
import jobsTools, { _setWaitForJobForTests } from "./jobs.js";
import { fakeMcpCtx } from "../../../test/helpers/fakeMcpCtx.js";

const USERS = [
  { id: "u_user", email: "user@example.com", role: "user", emailVerified: true },
  { id: "u_pub", email: "u_pub@example.com", role: "user", emailVerified: true },
  { id: "u_cap", email: "u_cap@example.com", role: "user", emailVerified: true },
];

const testApp = await startTestApp({ users: USERS });
const { port } = testApp;

let cachedKey = null;
/** One key for the file: a user may hold only a few. */
function userKey() {
  cachedKey ??= testApp.keyFor("u_user");
  return cachedKey;
}

const clients = [];
async function connect(bearer) {
  const client = await mcpClient(port, bearer);
  clients.push(client);
  return client;
}

afterEach(() => _setWaitForJobForTests(null));

after(async () => {
  await Promise.all(clients.map((c) => c.close().catch(() => {})));
  await testApp.close();
});

test("tools/list includes the four jobs tools", async () => {
  const client = await connect(userKey());
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const name of ["jobs_list", "jobs_get", "jobs_retry", "jobs_wait"]) assert.ok(names.includes(name), name);
});

test("jobs_list on an empty store returns an empty list", async () => {
  const client = await connect(userKey());
  const result = await client.callTool({ name: "jobs_list", arguments: {} });
  assert.notEqual(result.isError, true);
  assert.deepEqual(result.structuredContent, { jobs: [] });
});

function seedJobs(jobs) {
  fs.writeFileSync(path.join(testApp.dataDir, "jobs.json"), JSON.stringify({ jobs }, null, 2));
}

const DONE_JOB = {
  id: "job_done", type: "render_video", ownerId: "u_user", status: "done", progress: 100,
  createdAt: "2026-10-23T10:00:00.000Z",
  result: { outFile: "/srv/outputs/video-9.mp4", file: "/srv/outputs/video-9.mp4", videoUrl: "/outputs/video-9.mp4" },
};
const RUNNING_JOB = { id: "job_run", type: "render_video", ownerId: "u_user", status: "running", progress: 5, createdAt: "2026-10-23T11:00:00.000Z" };
const OTHER_JOB = { id: "job_other", type: "render_video", ownerId: "u_other", status: "done", progress: 100, createdAt: "2026-10-23T09:00:00.000Z" };

test("jobs_list returns this user's jobs as handles, newest first, within the limit", async () => {
  seedJobs([OTHER_JOB, DONE_JOB, RUNNING_JOB]);
  const client = await connect(userKey());
  const all = await client.callTool({ name: "jobs_list", arguments: {} });
  assert.deepEqual(all.structuredContent.jobs.map((j) => j.id), ["job_run", "job_done"]);
  const [running, done] = all.structuredContent.jobs;
  assert.equal(running.status, "running");
  assert.equal(running.percent, 5);
  assert.equal(running.type, "render_video");
  assert.equal(done.status, "done");
  assert.match(done.output.url, /^http:\/\/127\.0\.0\.1:\d+\/outputs\/video-9\.mp4$/);
  const one = await client.callTool({ name: "jobs_list", arguments: { limit: 1 } });
  assert.deepEqual(one.structuredContent.jobs.map((j) => j.id), ["job_run"]);
});

test("jobs_get returns the handle and hides other users' jobs", async () => {
  seedJobs([OTHER_JOB, DONE_JOB]);
  const client = await connect(userKey());
  const mine = await client.callTool({ name: "jobs_get", arguments: { id: "job_done" } });
  assert.equal(mine.structuredContent.id, "job_done");
  assert.equal(mine.structuredContent.status, "done");
  const theirs = await client.callTool({ name: "jobs_get", arguments: { id: "job_other" } });
  assert.equal(theirs.isError, true);
});

test("jobs_retry queues a new job from a finished one", async () => {
  seedJobs([{
    id: "job_old", type: "render_waveform", ownerId: "u_user", status: "failed", progress: 40, error: "boom",
    payload: { audioPath: "http://127.0.0.1:1/a.mp3" }, createdAt: "2026-10-23T10:00:00.000Z",
  }]);
  const client = await connect(userKey());
  const result = await client.callTool({ name: "jobs_retry", arguments: { id: "job_old" } });
  assert.notEqual(result.isError, true);
  assert.equal(result.structuredContent.status, "queued");
  assert.notEqual(result.structuredContent.id, "job_old");
  assert.match(result.structuredContent.id, /^job_/);
});

test("jobs_retry refuses a job that is still running", async () => {
  seedJobs([RUNNING_JOB]);
  const client = await connect(userKey());
  const result = await client.callTool({ name: "jobs_retry", arguments: { id: "job_run" } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /already running/i);
});

test("jobs_list rejects a limit outside 1..100", async () => {
  const client = await connect(userKey());
  const result = await client.callTool({ name: "jobs_list", arguments: { limit: 500 } });
  assert.equal(result.isError, true);
});

test("jobs_get on an unknown id is a tool error", async () => {
  const client = await connect(userKey());
  const result = await client.callTool({ name: "jobs_get", arguments: { id: "job_missing" } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /not found/i);
});

test("jobs_retry on an unknown id is a tool error", async () => {
  const client = await connect(userKey());
  const result = await client.callTool({ name: "jobs_retry", arguments: { id: "job_missing" } });
  assert.equal(result.isError, true);
});

test("jobs_wait with an unknown kind fails with BAD_KIND", async () => {
  const client = await connect(userKey());
  const result = await client.callTool({ name: "jobs_wait", arguments: { kind: "nope", id: "x" } });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error, "BAD_KIND");
  assert.match(result.structuredContent.message, /captioned/);
});

test("jobs_wait clamps timeoutSec to 90 and defaults to 60", async () => {
  const seen = [];
  _setWaitForJobForTests(async (_api, opts) => {
    seen.push(opts);
    return { kind: opts.kind, id: opts.id, status: "running", percent: null, phase: null, output: null, error: null };
  });
  const client = await connect(userKey());
  const big = await client.callTool({ name: "jobs_wait", arguments: { kind: "job", id: "job_1", timeoutSec: 500 } });
  assert.notEqual(big.isError, true);
  assert.equal(big.structuredContent.status, "running");
  await client.callTool({ name: "jobs_wait", arguments: { kind: "job", id: "job_1" } });
  await client.callTool({ name: "jobs_wait", arguments: { kind: "story", id: "p1", projectId: "p1", timeoutSec: 0 } });
  assert.deepEqual(seen.map((o) => o.timeoutSec), [90, 60, 1]);
  assert.equal(seen[2].projectId, "p1");
  assert.equal(typeof seen[0].outputUrl, "function");
});

// ---- Codex findings: retries respect publish consent, caps and plan quota ----

const campaignJob = (extra = {}) => ({
  id: "job_camp", type: "campaign_auto_post", ownerId: "u_pub", status: "done", progress: 100,
  payload: { niche: "faith" }, createdAt: "2026-10-23T10:00:00.000Z", ...extra,
});
const renderJob = (extra = {}) => ({
  id: "job_render", type: "render_waveform", ownerId: "u_pub", status: "failed", progress: 40,
  payload: { audioPath: "http://127.0.0.1:1/a.mp3" }, createdAt: "2026-10-23T10:00:00.000Z", ...extra,
});

const { resolveScopeDirs } = await import("../../lib/paths.js");
const { writeLibrary } = await import("../../lib/library.js");
const { incrementUsage, readUsage } = await import("../../lib/usageStore.js");
const { writeSocialStore } = await import("../../lib/socialStore.js");
const keyStore = await import("../../lib/agentKeys/store.js");

function userDir(userId) {
  return resolveScopeDirs({ sub: userId, email: `${userId}@example.com`, role: "user" }).dataDir;
}

function readJobRows() {
  return JSON.parse(fs.readFileSync(path.join(testApp.dataDir, "jobs.json"), "utf-8")).jobs;
}

async function keyClient(userId, publishAllowed) {
  const made = keyStore.createKey(userId, `retry-${publishAllowed ? "on" : "off"}`);
  if (publishAllowed) keyStore.updateKey(userId, made.key.id, { publishAllowed: true });
  return connect(made.plain);
}

async function capsUsed(client) {
  const who = await client.callTool({ name: "whoami", arguments: {} });
  return Object.fromEntries(Object.entries(who.structuredContent.caps).map(([b, c]) => [b, c.used]));
}

test("jobs_retry of a posting job without the publish switch is refused and charges nothing", async () => {
  writeLibrary(userDir("u_pub"), { items: [{ id: "bg1", path: "http://127.0.0.1:1/bg.mp4" }] });
  seedJobs([campaignJob()]);
  const client = await keyClient("u_pub", false);
  const result = await client.callTool({ name: "jobs_retry", arguments: { id: "job_camp" } });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error, "PUBLISH_NOT_ALLOWED");
  assert.equal(readJobRows().length, 1);
  const used = await capsUsed(client);
  assert.equal(used.renders, 0);
  assert.equal(used.publishes, 0);
});

test("jobs_retry of a posting job with the publish switch queues it and charges a render and a publish", async () => {
  writeLibrary(userDir("u_pub"), { items: [{ id: "bg1", path: "http://127.0.0.1:1/bg.mp4" }] });
  seedJobs([campaignJob()]);
  const client = await keyClient("u_pub", true);
  const result = await client.callTool({ name: "jobs_retry", arguments: { id: "job_camp" } });
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  assert.equal(result.structuredContent.type, "campaign_auto_post");
  const used = await capsUsed(client);
  assert.equal(used.renders, 1);
  assert.equal(used.publishes, 1);
});

test("a render retried without the publish switch is queued with auto-publish suppressed", async () => {
  seedJobs([renderJob()]);
  const client = await keyClient("u_pub", false);
  const result = await client.callTool({ name: "jobs_retry", arguments: { id: "job_render" } });
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  const row = readJobRows().find((j) => j.id === result.structuredContent.id);
  assert.equal(row.suppressAutoPublish, true);
  const used = await capsUsed(client);
  assert.equal(used.renders, 1);
  assert.equal(used.publishes, 0);
});

test("a render retried with the publish switch and auto-publish off charges only a render", async () => {
  writeSocialStore(userDir("u_pub"), { postiz: { autoPublish: false, autoPublishPlatforms: [] } });
  seedJobs([renderJob()]);
  const client = await keyClient("u_pub", true);
  const result = await client.callTool({ name: "jobs_retry", arguments: { id: "job_render" } });
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  const row = readJobRows().find((j) => j.id === result.structuredContent.id);
  assert.equal(row.suppressAutoPublish, undefined);
  const used = await capsUsed(client);
  assert.equal(used.renders, 1);
  assert.equal(used.publishes, 0);
});

test("a render retried with the publish switch and auto-publish on also charges a publish", async () => {
  writeSocialStore(userDir("u_pub"), { postiz: { autoPublish: true, autoPublishPlatforms: ["tiktok"] } });
  seedJobs([renderJob()]);
  const client = await keyClient("u_pub", true);
  const result = await client.callTool({ name: "jobs_retry", arguments: { id: "job_render" } });
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  const row = readJobRows().find((j) => j.id === result.structuredContent.id);
  assert.equal(row.suppressAutoPublish, undefined);
  const used = await capsUsed(client);
  assert.equal(used.renders, 1);
  assert.equal(used.publishes, 1);
  writeSocialStore(userDir("u_pub"), { postiz: { autoPublish: false, autoPublishPlatforms: [] } });
});

test("jobs_retry for a free user at the render limit returns QUOTA_EXCEEDED", async () => {
  incrementUsage(userDir("u_cap"), "render", 5);
  seedJobs([renderJob({ ownerId: "u_cap" })]);
  const client = await keyClient("u_cap", false);
  const result = await client.callTool({ name: "jobs_retry", arguments: { id: "job_render" } });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error, "QUOTA_EXCEEDED");
  assert.equal(readJobRows().length, 1);
  assert.equal(readUsage(userDir("u_cap")).counts.render, 5);
});

test("a posting-job retry refused on publishes spends no render either (one atomic charge)", async () => {
  writeLibrary(userDir("u_pub"), { items: [{ id: "bg1", path: "http://127.0.0.1:1/bg.mp4" }] });
  seedJobs([campaignJob()]);
  const made = keyStore.createKey("u_pub", "retry-no-publishes");
  keyStore.updateKey("u_pub", made.key.id, { publishAllowed: true, caps: { publishes: 0 } });
  const client = await connect(made.plain);
  const result = await client.callTool({ name: "jobs_retry", arguments: { id: "job_camp" } });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error, "MCP_CAP_REACHED");
  assert.equal(result.structuredContent.bucket, "publishes");
  assert.equal(readJobRows().length, 1);
  const used = await capsUsed(client);
  assert.equal(used.renders, 0);
  assert.equal(used.publishes, 0);
  keyStore.revokeKey("u_pub", made.key.id);
});

test("a render retry that would auto-post, refused on publishes, spends no render either (one atomic charge)", async () => {
  writeSocialStore(userDir("u_pub"), { postiz: { autoPublish: true, autoPublishPlatforms: ["tiktok"] } });
  seedJobs([renderJob()]);
  const made = keyStore.createKey("u_pub", "render-retry-no-publishes");
  keyStore.updateKey("u_pub", made.key.id, { publishAllowed: true, caps: { publishes: 0 } });
  const client = await connect(made.plain);
  const result = await client.callTool({ name: "jobs_retry", arguments: { id: "job_render" } });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.bucket, "publishes");
  assert.equal(readJobRows().length, 1);
  const used = await capsUsed(client);
  assert.equal(used.renders, 0);
  keyStore.revokeKey("u_pub", made.key.id);
  writeSocialStore(userDir("u_pub"), { postiz: { autoPublish: false, autoPublishPlatforms: [] } });
});

// ---- Consent fails closed: a context without an agent key never posts ----

const jobsRetryDef = jobsTools.find((def) => def.name === "jobs_retry");

test("jobs_retry with no agentKey refuses a posting job and never queues it", async () => {
  const { ctx, calls, charges } = fakeMcpCtx({ "GET /api/jobs/job_camp": { ok: true, job: campaignJob() } });
  const result = await jobsRetryDef.handler(ctx, { id: "job_camp" });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error, "PUBLISH_NOT_ALLOWED");
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ["GET /api/jobs/job_camp"]);
  assert.deepEqual(charges, []);
});

test("jobs_retry with no agentKey queues a render with auto-publish off", async () => {
  const { ctx, calls, charges } = fakeMcpCtx({
    "GET /api/jobs/job_render": { ok: true, job: renderJob() },
    "POST /api/jobs/job_render/retry": { ok: true, job: renderJob({ id: "job_new", status: "queued" }) },
  });
  const result = await jobsRetryDef.handler(ctx, { id: "job_render" });
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ["GET /api/jobs/job_render", "POST /api/jobs/job_render/retry"]);
  assert.deepEqual(calls[1].opts, { body: { autoPublish: false } });
  assert.deepEqual(charges, [{ bucket: "renders", amount: 1 }]);
});
