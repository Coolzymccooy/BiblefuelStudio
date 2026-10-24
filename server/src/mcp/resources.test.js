import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startTestApp, mcpClient } from "../../test/helpers/mcpTestApp.js";
import { fakeMcpCtx } from "../../test/helpers/fakeMcpCtx.js";
import { JOB_TEMPLATE_URI, readJobHandle, readJobResource, jobAddress } from "./resources.js";

// The job resource template answers exactly what jobs_get / jobs_wait answer, through the same
// normalisers and the caller's own loopback API, so ownership and errors cannot differ.

const USERS = [
  { id: "u_user", email: "user@example.com", role: "user", emailVerified: true },
  { id: "u_other", email: "other@example.com", role: "user", emailVerified: true },
];

const testApp = await startTestApp({ users: USERS });
const { port } = testApp;

const DONE_JOB = {
  id: "job_done", type: "render_video", ownerId: "u_user", status: "done", progress: 100,
  createdAt: "2026-10-23T10:00:00.000Z",
  result: { outFile: "/srv/outputs/video-9.mp4", file: "/srv/outputs/video-9.mp4", videoUrl: "/outputs/video-9.mp4" },
};
const OTHER_JOB = { id: "job_other", type: "render_video", ownerId: "u_other", status: "done", progress: 100, createdAt: "2026-10-23T09:00:00.000Z" };
fs.writeFileSync(path.join(testApp.dataDir, "jobs.json"), JSON.stringify({ jobs: [DONE_JOB, OTHER_JOB] }, null, 2));

const client = await mcpClient(port, testApp.keyFor("u_user"));

after(async () => {
  await client.close().catch(() => {});
  await testApp.close();
});

/** The JSON-RPC error a resource read is refused with. */
async function readError(uri) {
  try {
    await client.readResource({ uri });
  } catch (err) {
    return err;
  }
  assert.fail(`${uri} was read, but should have been refused`);
}

test("resources/templates/list shows the job template as JSON", async () => {
  const { resourceTemplates } = await client.listResourceTemplates();
  const job = resourceTemplates.find((t) => t.uriTemplate === "biblefuel://jobs/{kind}/{id}");
  assert.ok(job, "the job template is listed");
  assert.equal(job.mimeType, "application/json");
  assert.equal(JOB_TEMPLATE_URI, "biblefuel://jobs/{kind}/{id}");
});

test("resources/list lists the two guide resources, and no job entries", async () => {
  const { resources } = await client.listResources();
  assert.deepEqual(resources.map((r) => r.uri), ["biblefuel://guide", "biblefuel://guide/setup"]);
});

test("reading a done job returns the same handle as jobs_get, as JSON", async () => {
  const { contents } = await client.readResource({ uri: "biblefuel://jobs/job/job_done" });
  assert.equal(contents.length, 1);
  assert.equal(contents[0].uri, "biblefuel://jobs/job/job_done");
  assert.equal(contents[0].mimeType, "application/json");
  const handle = JSON.parse(contents[0].text);
  const viaTool = await client.callTool({ name: "jobs_get", arguments: { id: "job_done" } });
  assert.deepEqual(handle, viaTool.structuredContent);
  assert.equal(handle.status, "done");
  assert.match(handle.output.url, /^http:\/\/127\.0\.0\.1:\d+\/outputs\/video-9\.mp4$/);
});

test("an unknown kind is refused with the BAD_KIND answer jobs_wait gives", async () => {
  const err = await readError("biblefuel://jobs/nope/job_done");
  const viaTool = await client.callTool({ name: "jobs_wait", arguments: { kind: "nope", id: "job_done", timeoutSec: 1 } });
  assert.equal(viaTool.isError, true);
  assert.ok(err.message.includes(viaTool.content[0].text), `${err.message} vs ${viaTool.content[0].text}`);
  assert.equal(err.data.error, "BAD_KIND");
});

test("another user's job reads exactly like a missing one, as jobs_get answers it", async () => {
  const theirs = await readError("biblefuel://jobs/job/job_other");
  const missing = await readError("biblefuel://jobs/job/job_missing");
  const viaTool = await client.callTool({ name: "jobs_get", arguments: { id: "job_other" } });
  assert.equal(viaTool.isError, true);
  assert.ok(theirs.message.includes(viaTool.content[0].text), `${theirs.message} vs ${viaTool.content[0].text}`);
  assert.equal(theirs.message, missing.message);
  assert.deepEqual(theirs.data, missing.data);
  assert.doesNotMatch(JSON.stringify(theirs.data), /u_other|render_video|2026-10-23T09/);
});

test("a lyric_render without projectId is BAD_INPUT, like jobs_wait, and shows the resource's query form", async () => {
  const err = await readError("biblefuel://jobs/lyric_render/r_1");
  const viaTool = await client.callTool({ name: "jobs_wait", arguments: { kind: "lyric_render", id: "r_1", timeoutSec: 1 } });
  assert.equal(viaTool.structuredContent.error, "BAD_INPUT");
  assert.equal(err.data.error, "BAD_INPUT");
  assert.ok(err.data.message.includes("biblefuel://jobs/lyric_render/<jobId>?projectId=<id>"), err.data.message);
});

// ---- unit: the read itself ---------------------------------------------------

test("readJobHandle reads the kind's status route once through ctx.api and normalises it", async () => {
  const { ctx, calls } = fakeMcpCtx({
    "GET /api/timeline/render/t_9": { ok: true, jobId: "t_9", status: "done", progress: 100, file: "/srv/outputs/u/tl-9.mp4", publicUrl: "/outputs/u/tl-9.mp4" },
  });
  const handle = await readJobHandle(ctx, { kind: "timeline", id: "t_9" });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ["GET /api/timeline/render/t_9"]);
  assert.equal(handle.kind, "timeline");
  assert.equal(handle.id, "t_9");
  assert.equal(handle.status, "done");
  assert.equal(handle.output.url, "http://host.test/outputs/u/tl-9.mp4");
});

test("readJobHandle passes projectId to a nested route and echoes it on the handle", async () => {
  const { ctx, calls } = fakeMcpCtx({
    "GET /api/lyric-video/p_1/render/r_1": { ok: true, job: { jobId: "r_1", status: "running", percent: 40 } },
  });
  const handle = await readJobHandle(ctx, { kind: "lyric_render", id: "r_1", projectId: "p_1" });
  assert.equal(calls[0].path, "/api/lyric-video/p_1/render/r_1");
  assert.equal(handle.id, "r_1");
  assert.equal(handle.projectId, "p_1");
});

test("an app error becomes an MCP error carrying the code, message, hint and status", async () => {
  const apiError = Object.assign(new Error("Not found"), { name: "ApiError", status: 404, code: "HTTP_404", hint: null });
  const { ctx } = fakeMcpCtx({ "GET /api/story/s_1": apiError });
  await assert.rejects(readJobHandle(ctx, { kind: "story", id: "s_1" }), (err) => {
    assert.match(err.message, /HTTP_404: Not found/);
    assert.deepEqual(err.data, { error: "HTTP_404", message: "Not found", hint: null, status: 404 });
    return true;
  });
});

test("an unexpected failure is INTERNAL and says nothing more", async () => {
  const { ctx } = fakeMcpCtx({ "GET /api/story/s_1": new Error("ECONNRESET at 10.0.0.5") });
  await assert.rejects(readJobHandle(ctx, { kind: "story", id: "s_1" }), (err) => {
    assert.match(err.message, /INTERNAL: Something went wrong/);
    assert.doesNotMatch(err.message, /ECONNRESET|10\.0\.0\.5/);
    return true;
  });
});

test("jobAddress decodes the id and reads projectId from the query", () => {
  const uri = new URL("biblefuel://jobs/lyric_render/r%201?projectId=p%2F1");
  assert.deepEqual(jobAddress(uri, { kind: "lyric_render", id: "r%201?projectId=p%2F1" }), {
    kind: "lyric_render", id: "r 1", projectId: "p/1",
  });
  assert.deepEqual(jobAddress(new URL("biblefuel://jobs/job/job_1"), { kind: "job", id: "job_1" }), {
    kind: "job", id: "job_1", projectId: undefined,
  });
});

test("jobAddress refuses a malformed id as BAD_INPUT", () => {
  assert.throws(() => jobAddress(new URL("biblefuel://jobs/job/%E0%A4%A"), { kind: "job", id: "%E0%A4%A" }), (err) => {
    assert.equal(err.data.error, "BAD_INPUT");
    return true;
  });
});

// M1: "." and ".." would move the loopback route up a level (the review reached /api/render/... this way).
test("a .. projectId in the query is refused as BAD_INPUT through the real transport", async () => {
  const err = await readError("biblefuel://jobs/lyric_render/captioned-video-history?projectId=..");
  assert.equal(err.data.error, "BAD_INPUT");
  assert.match(err.data.message, /not a valid id/);
});

test("readJobHandle refuses an empty, . or .. id or projectId before any loopback call", async () => {
  for (const address of [
    { kind: "story", id: ".." },
    { kind: "job", id: "." },
    { kind: "lyric_render", id: "r_1", projectId: ".." },
    { kind: "lyric_render", id: "r_1", projectId: "." },
    { kind: "timeline", id: "t_1", projectId: ".." },
  ]) {
    const { ctx, calls } = fakeMcpCtx({});
    await assert.rejects(readJobHandle(ctx, address), (err) => err.data?.error === "BAD_INPUT", JSON.stringify(address));
    assert.equal(calls.length, 0, JSON.stringify(address));
  }
});

// L1: a route's server error is not the caller's bad input, so it is InternalError (-32603), with the same data.
test("a 5xx answer from the route is an InternalError carrying the route's code and status", async () => {
  const apiError = Object.assign(new Error("Bad gateway"), { name: "ApiError", status: 502, code: "HTTP_502", hint: null });
  const { ctx } = fakeMcpCtx({ "GET /api/story/s_1": apiError });
  await assert.rejects(readJobHandle(ctx, { kind: "story", id: "s_1" }), (err) => {
    assert.equal(err.code, -32603);
    assert.deepEqual(err.data, { error: "HTTP_502", message: "Bad gateway", hint: null, status: 502 });
    return true;
  });
});

test("a 4xx answer from the route stays InvalidParams (-32602)", async () => {
  const apiError = Object.assign(new Error("Not found"), { name: "ApiError", status: 404, code: "HTTP_404", hint: null });
  const { ctx } = fakeMcpCtx({ "GET /api/story/s_1": apiError });
  await assert.rejects(readJobHandle(ctx, { kind: "story", id: "s_1" }), (err) => err.code === -32602);
});

// L2: a payload the normaliser cannot read is the server's failure: INTERNAL, never the raw exception text.
test("a normaliser that throws answers INTERNAL with a fixed message", async () => {
  const odd = { get job() { throw new TypeError("Cannot read properties of undefined (reading 'secret')"); } };
  const { ctx } = fakeMcpCtx({ "GET /api/jobs/job_1": odd });
  await assert.rejects(readJobHandle(ctx, { kind: "job", id: "job_1" }), (err) => {
    assert.equal(err.code, -32603);
    assert.match(err.message, /INTERNAL: Something went wrong/);
    assert.doesNotMatch(err.message, /secret|Cannot read/);
    assert.deepEqual(err.data, { error: "INTERNAL", message: "Something went wrong" });
    return true;
  });
});

// L8: one [MCP] info line per read, so ops can see read volume: the key, the kind and the outcome, never an id.
async function loggedLines(run) {
  const lines = [];
  const original = console.info;
  console.info = (...args) => lines.push(args.join(" "));
  try {
    await run();
  } finally {
    console.info = original;
  }
  return lines.filter((line) => line.startsWith("[MCP]"));
}

test("readJobResource logs one line per read with the key, kind and status, and no ids", async () => {
  const { ctx } = fakeMcpCtx({ "GET /api/story/s_secret": { ok: true, project: { projectId: "s_secret", status: "draft" } } });
  const keyed = { ...ctx, agentKey: { id: "ak_1234567890abcdef" } };
  const ok = await loggedLines(() => readJobResource(keyed, { kind: "story", id: "s_secret" }));
  assert.equal(ok.length, 1);
  assert.match(ok[0], /^\[MCP\] key=ak_12345 resource=job kind=story ms=\d+ ok status=200$/);
  assert.doesNotMatch(ok[0], /s_secret/);

  const missing = Object.assign(new Error("Not found"), { name: "ApiError", status: 404, code: "HTTP_404", hint: null });
  const { ctx: ctx404 } = fakeMcpCtx({ "GET /api/story/u_other_story": missing });
  const refused = await loggedLines(() =>
    assert.rejects(readJobResource({ ...ctx404, agentKey: { id: "ak_1234567890abcdef" } }, { kind: "story", id: "u_other_story" })),
  );
  assert.equal(refused.length, 1);
  assert.match(refused[0], /kind=story ms=\d+ error=HTTP_404 status=404$/);
  assert.doesNotMatch(refused[0], /u_other_story/);
});

test("an unknown kind is logged as unknown, not echoed", async () => {
  const { ctx } = fakeMcpCtx({});
  const lines = await loggedLines(() => assert.rejects(readJobResource(ctx, { kind: "evil\nkind", id: "x" })));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /kind=unknown ms=\d+ error=BAD_KIND status=-$/);
  assert.doesNotMatch(lines[0], /evil/);
});
