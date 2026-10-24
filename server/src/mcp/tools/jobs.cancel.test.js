import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startTestApp, mcpClient } from "../../../test/helpers/mcpTestApp.js";
import { fakeMcpCtx } from "../../../test/helpers/fakeMcpCtx.js";
import jobsTools from "./jobs.js";
import { CANCEL_ROUTES } from "../jobCancel.js";
import { JOB_KINDS } from "../jobs.js";

// #121: one jobs_cancel { kind, id, projectId? } for every kind of job that has a cancel route.

const USER = { id: "u_cancel", email: "cancel@example.com", role: "user", emailVerified: true };
const testApp = await startTestApp({ users: [USER] });
const client = await mcpClient(testApp.port, testApp.keyFor(USER.id));
const { _setExecuteJobForTests } = await import("../../routes/jobs.js");

after(async () => {
  _setExecuteJobForTests(null);
  await client.close().catch(() => {});
  await testApp.close();
});

const jobsCancel = jobsTools.find((t) => t.name === "jobs_cancel");
const posts = (calls) => calls.filter((c) => c.method === "POST").map((c) => c.path);

/** Calls jobs_cancel with the status route answering `body`; the cancel route answers ok. */
async function cancelWith(kind, statusRoute, body, input = {}) {
  const { ctx, calls } = fakeMcpCtx({ [`GET ${statusRoute}`]: body });
  const read = ctx.api.call;
  ctx.api.call = async (method, p, opts) => {
    if (method !== "POST") return read(method, p, opts);
    calls.push({ method, path: p, opts });
    return { ok: true };
  };
  const result = await jobsCancel.handler(ctx, { kind, ...input });
  return { result, posted: posts(calls) };
}

const RUNNING = {
  job: ["/api/jobs/job_1", { ok: true, job: { id: "job_1", status: "running" } }, { id: "job_1" }, "/api/jobs/job_1/cancel"],
  captioned: ["/api/render/captioned-video-status/c1", { ok: true, jobId: "c1", status: "running" }, { id: "c1" }, "/api/render/captioned-video/c1/cancel"],
  story: ["/api/story/p1", { ok: true, project: { projectId: "p1", status: "rendering", render: { percent: 3 } } }, { id: "p1" }, "/api/story/p1/cancel"],
  longform: ["/api/story/p2", { ok: true, project: { projectId: "p2", status: "narrating", longform: { progress: { total: 4, done: 1 } } } }, { id: "p2" }, "/api/story/p2/cancel"],
  ambient: ["/api/ambient/a1", { ok: true, project: { projectId: "a1", status: "rendering", render: { percent: 5 } } }, { id: "a1" }, "/api/ambient/a1/cancel"],
  moments: ["/api/moments/m1", { ok: true, project: { projectId: "m1", render: { status: "running", percent: 10 } } }, { id: "m1" }, "/api/moments/m1/cancel"],
  scene: ["/api/scene-script/s1", { ok: true, project: { id: "s1", running: { render: true }, lines: [], shots: [] } }, { id: "s1" }, "/api/scene-script/s1/render/cancel"],
  lyric_render: ["/api/lyric-video/lv_1/render/r1", { ok: true, job: { jobId: "r1", status: "running" } }, { id: "r1", projectId: "lv_1" }, "/api/lyric-video/lv_1/render/r1/cancel"],
};

test("every kind with a cancel route is covered, and each is a real job kind", () => {
  assert.deepEqual(Object.keys(CANCEL_ROUTES).sort(), Object.keys(RUNNING).sort());
  for (const kind of Object.keys(CANCEL_ROUTES)) assert.ok(JOB_KINDS.includes(kind), kind);
});

for (const [kind, [statusRoute, body, input, cancelRoute]] of Object.entries(RUNNING)) {
  test(`jobs_cancel stops a running ${kind} job through its own cancel route`, async () => {
    const { result, posted } = await cancelWith(kind, statusRoute, body, input);
    assert.notEqual(result.isError, true, result.content?.[0]?.text);
    assert.deepEqual(posted, [cancelRoute]);
    assert.deepEqual(result.structuredContent, { kind, ...input, cancelled: true });
  });
}

test("a story making AI motion clips is stopped with its animate cancel", async () => {
  const project = { projectId: "p3", status: "ready_to_render", scenes: [{ imageStatus: "done", aiVideoStatus: "generating" }] };
  const { posted } = await cancelWith("story", "/api/story/p3", { ok: true, project }, { id: "p3" });
  assert.deepEqual(posted, ["/api/story/p3/animate/cancel"]);
});

test("a scene script ordering clips is stopped with its shots cancel", async () => {
  const project = { id: "s2", running: { shots: true }, lines: [], shots: [] };
  const { posted } = await cancelWith("scene", "/api/scene-script/s2", { ok: true, project }, { id: "s2" });
  assert.deepEqual(posted, ["/api/scene-script/s2/shots/cancel"]);
});

test("voicing (ambient or scene script) cannot be stopped: VOICING_CANNOT_CANCEL and nothing is posted", async () => {
  const ambient = await cancelWith("ambient", "/api/ambient/a2", { ok: true, project: { projectId: "a2", status: "voicing" } }, { id: "a2" });
  assert.equal(ambient.result.structuredContent.error, "VOICING_CANNOT_CANCEL");
  assert.deepEqual(ambient.posted, []);
  const scene = await cancelWith("scene", "/api/scene-script/s3", { ok: true, project: { id: "s3", running: { voice: true }, lines: [], shots: [] } }, { id: "s3" });
  assert.equal(scene.result.structuredContent.error, "VOICING_CANNOT_CANCEL");
  assert.deepEqual(scene.posted, []);
});

test("a job that is not queued or running is refused with NOTHING_RUNNING, and its cancel route is never called", async () => {
  for (const status of ["done", "failed", "cancelled"]) {
    const { result, posted } = await cancelWith("job", "/api/jobs/job_2", { ok: true, job: { id: "job_2", status } }, { id: "job_2" });
    assert.equal(result.structuredContent.error, "NOTHING_RUNNING", status);
    assert.equal(result.structuredContent.jobStatus, status);
    assert.deepEqual(posted, []);
  }
});

test("a kind with no cancel route is BAD_KIND; bad ids and a lyric_render without projectId are BAD_INPUT, before any call", async () => {
  const { ctx, calls } = fakeMcpCtx({});
  for (const kind of ["timeline", "lyric_align", "instrumental", "publish", "nope"]) {
    const result = await jobsCancel.handler(ctx, { kind, id: "x1" });
    assert.equal(result.structuredContent.error, "BAD_KIND", kind);
    assert.match(result.structuredContent.message, /job, captioned/);
  }
  assert.equal((await jobsCancel.handler(ctx, { kind: "job", id: ".." })).structuredContent.error, "BAD_INPUT");
  assert.equal((await jobsCancel.handler(ctx, { kind: "lyric_render", id: "r1" })).structuredContent.error, "BAD_INPUT");
  assert.deepEqual(calls, []);
});

test("tools/list has jobs_cancel and no render_cancel; jobs_list says it lists queued render jobs only", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  assert.ok(names.includes("jobs_cancel"));
  assert.equal(names.includes("render_cancel"), false);
  const list = tools.find((t) => t.name === "jobs_list");
  assert.match(list.description, /queued render jobs only/);
  const cancel = tools.find((t) => t.name === "jobs_cancel");
  assert.match(cancel.description, /NOTHING_RUNNING/);
  for (const kind of Object.keys(CANCEL_ROUTES)) assert.match(cancel.description, new RegExp(`\\b${kind}\\b`));
});

test("a real queued render_short job is cancelled through jobs_cancel, and jobs_wait then reads it cancelled", async () => {
  _setExecuteJobForTests(async () => new Promise(() => {}));
  const job = { id: "job_cancel_me", type: "render_video", payload: { lines: ["Peace"] }, ownerId: USER.id, status: "running", createdAt: "2026-10-24T10:00:00.000Z" };
  fs.writeFileSync(path.join(testApp.dataDir, "jobs.json"), JSON.stringify({ jobs: [job] }, null, 2));
  const result = await client.callTool({ name: "jobs_cancel", arguments: { kind: "job", id: job.id } });
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  assert.equal(result.structuredContent.cancelled, true);
  const waited = await client.callTool({ name: "jobs_wait", arguments: { kind: "job", id: job.id, timeoutSec: 1 } });
  assert.equal(waited.structuredContent.status, "cancelled");
  const again = await client.callTool({ name: "jobs_cancel", arguments: { kind: "job", id: job.id } });
  assert.equal(again.structuredContent.error, "NOTHING_RUNNING");
});
