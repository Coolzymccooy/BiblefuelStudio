import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { startTestApp, mcpClient } from "../../../test/helpers/mcpTestApp.js";
import { fakeMcpCtx } from "../../../test/helpers/fakeMcpCtx.js";
import { _setScopeForTests } from "../mediaPath.js";
import tools from "./visualLibrary.js";

const USER = { id: "u_user", email: "user@example.com", role: "user", emailVerified: true };
const ADMIN = { id: "u_admin", email: "admin@example.com", role: "user", emailVerified: true };
const testApp = await startTestApp({ users: [USER, ADMIN], superAdminEmail: ADMIN.email });
const userClient = await mcpClient(testApp.port, testApp.keyFor(USER.id));
const adminClient = await mcpClient(testApp.port, testApp.keyFor(ADMIN.id, "admin"));

after(async () => {
  _setScopeForTests(null);
  await userClient.close().catch(() => {});
  await adminClient.close().catch(() => {});
  await testApp.close();
});

const [visualLibrary] = tools;

/** What the loopback client throws for a non-2xx answer (api.js is not imported: it reads env at import). */
const apiError = (status, message) => Object.assign(new Error(message), { name: "ApiError", status, code: `HTTP_${status}` });

const CLIP = { id: "c1", prompt: "a lamb on a hill", aspect: "portrait", durationSec: 5, costUsd: 0.4, tags: ["lamb"], rating: null, url: "/outputs/visual-library/c1/clip.mp4", posterUrl: "/outputs/visual-library/c1/poster.jpg" };

test("the file declares visual_library, super-admin only, on /api/visual-library", () => {
  assert.deepEqual(tools.map((t) => t.name), ["visual_library"]);
  assert.equal(visualLibrary.requires, "super_admin");
  assert.deepEqual(visualLibrary.routes, ["/api/visual-library"]);
  assert.match(visualLibrary.description, /super.admin/i);
});

test("list maps the filters to the route's query and returns clips with full urls", async () => {
  const { ctx, calls } = fakeMcpCtx({ "GET /api/visual-library": { ok: true, clips: [CLIP], total: 4 } });
  const result = await visualLibrary.handler(ctx, { action: "list", q: "lamb", aspect: "portrait", tag: "lamb", minRating: 3, limit: 10 });
  assert.deepEqual(calls[0].opts.query, { q: "lamb", aspect: "portrait", tag: "lamb", rating: 3, limit: 10 });
  assert.equal(result.structuredContent.total, 4);
  assert.equal(result.structuredContent.clips[0].url, "http://host.test/outputs/visual-library/c1/clip.mp4");
  assert.equal(result.structuredContent.clips[0].posterUrl, "http://host.test/outputs/visual-library/c1/poster.jpg");
});

test("similar needs a prompt and returns scored matches", async () => {
  const { ctx, calls } = fakeMcpCtx({ "GET /api/visual-library/similar": { ok: true, matches: [{ clip: CLIP, score: 0.8 }] } });
  const none = await visualLibrary.handler(ctx, { action: "similar" });
  assert.equal(none.structuredContent.error, "BAD_INPUT");
  const result = await visualLibrary.handler(ctx, { action: "similar", prompt: "a lamb", aspect: "portrait" });
  assert.deepEqual(calls[0].opts.query, { prompt: "a lamb", aspect: "portrait" });
  assert.equal(result.structuredContent.matches[0].score, 0.8);
  assert.equal(result.structuredContent.matches[0].clip.id, "c1");
});

test("update sends tags and rating by PATCH and needs an id", async () => {
  const { ctx, calls } = fakeMcpCtx({ "PATCH /api/visual-library/c1": { ok: true, clip: CLIP } });
  const missing = await visualLibrary.handler(ctx, { action: "update", tags: ["x"] });
  assert.equal(missing.structuredContent.error, "BAD_INPUT");
  const nothing = await visualLibrary.handler(ctx, { action: "update", id: "c1" });
  assert.equal(nothing.structuredContent.error, "BAD_INPUT");
  const result = await visualLibrary.handler(ctx, { action: "update", id: "c1", tags: ["lamb"], rating: 5 });
  assert.deepEqual(calls[0].opts.body, { tags: ["lamb"], rating: 5 });
  assert.equal(result.structuredContent.clip.id, "c1");
});

test("remove deletes and passes force as force=1; an in-use clip is a clear error", async () => {
  const { ctx, calls } = fakeMcpCtx({ "DELETE /api/visual-library/c1": { ok: true } });
  const result = await visualLibrary.handler(ctx, { action: "remove", id: "c1", force: true });
  assert.deepEqual(result.structuredContent, { removed: "c1" });
  assert.deepEqual(calls[0].opts.query, { force: 1 });
  const busy = fakeMcpCtx({ "DELETE /api/visual-library/c2": apiError(409, "This clip is used in Psalm 23.") });
  const refused = await visualLibrary.handler(busy.ctx, { action: "remove", id: "c2" });
  assert.equal(refused.structuredContent.error, "IN_USE");
  assert.match(refused.structuredContent.message, /force/);
});

test("import resolves uploadPath inside the media folder and sends the optional fields", async () => {
  const dir = fs.mkdtempSync(path.join(testApp.dataDir, "vl-media-"));
  const name = "bg-video-123e4567-e89b-12d3-a456-426614174000.mp4";
  fs.writeFileSync(path.join(dir, name), "x");
  _setScopeForTests(async () => ({ outputDir: dir, sharedDir: path.join(dir, "none") }));
  const { ctx, calls } = fakeMcpCtx({ "POST /api/visual-library/import": { ok: true, clip: CLIP } });
  const result = await visualLibrary.handler(ctx, { action: "import", uploadPath: path.join(dir, name), prompt: "a lamb", tags: ["lamb"], costUsd: 0.5 });
  assert.deepEqual(calls[0].opts.body, { uploadPath: fs.realpathSync(path.join(dir, name)), prompt: "a lamb", tags: ["lamb"], costUsd: 0.5 });
  assert.equal(result.structuredContent.clip.id, "c1");
});

test("import refuses a path outside the media folder and a URL, and needs uploadPath", async () => {
  const dir = fs.mkdtempSync(path.join(testApp.dataDir, "vl-media-"));
  _setScopeForTests(async () => ({ outputDir: dir, sharedDir: path.join(dir, "none") }));
  const { ctx, calls } = fakeMcpCtx({});
  const outside = await visualLibrary.handler(ctx, { action: "import", uploadPath: path.join(testApp.dataDir, "users.json") });
  assert.equal(outside.structuredContent.error, "PATH_OUTSIDE_MEDIA");
  const url = await visualLibrary.handler(ctx, { action: "import", uploadPath: "https://example.com/a.mp4" });
  assert.equal(url.structuredContent.error, "PATH_OUTSIDE_MEDIA");
  const none = await visualLibrary.handler(ctx, { action: "import" });
  assert.equal(none.structuredContent.error, "BAD_INPUT");
  assert.equal(calls.length, 0);
});

test("a normal user's key does not see visual_library; the super-admin's does", async () => {
  const user = (await userClient.listTools()).tools.map((t) => t.name);
  const admin = (await adminClient.listTools()).tools.map((t) => t.name);
  assert.ok(!user.includes("visual_library"));
  assert.ok(admin.includes("visual_library"));
});

test("a normal user calling visual_library anyway is refused", async () => {
  const result = await userClient.callTool({ name: "visual_library", arguments: { action: "list" } });
  assert.equal(result.isError, true);
});

test("the super-admin lists and searches the real (empty) library, and an unknown clip is a tool error", async () => {
  _setScopeForTests(null);
  const list = await adminClient.callTool({ name: "visual_library", arguments: { action: "list" } });
  assert.notEqual(list.isError, true, list.content?.[0]?.text);
  assert.deepEqual(list.structuredContent, { clips: [], total: 0 });
  const similar = await adminClient.callTool({ name: "visual_library", arguments: { action: "similar", prompt: "a lamb on a hill" } });
  assert.deepEqual(similar.structuredContent, { matches: [] });
  const gone = await adminClient.callTool({ name: "visual_library", arguments: { action: "remove", id: "00000000-0000-4000-8000-000000000000" } });
  assert.equal(gone.isError, true);
  assert.equal(gone.structuredContent.status, 404);
});

test("clip ids must be plain ids, and the description does not promise an import no tool can make", () => {
  const schema = z.object(visualLibrary.inputSchema);
  assert.equal(schema.safeParse({ action: "remove", id: "123e4567-e89b-12d3-a456-426614174000" }).success, true);
  for (const id of ["../x", "a/b", "a?force=1", "a b", ""]) assert.equal(schema.safeParse({ action: "remove", id }).success, false, id);
  assert.doesNotMatch(visualLibrary.description, /Story animate/);
  assert.match(visualLibrary.description, /no tool here creates one/);
});
