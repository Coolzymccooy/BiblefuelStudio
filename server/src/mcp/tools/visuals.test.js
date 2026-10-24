import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startTestApp, mcpClient } from "../../../test/helpers/mcpTestApp.js";
import { fakeMcpCtx } from "../../../test/helpers/fakeMcpCtx.js";
import { _setScopeForTests } from "../mediaPath.js";
import visualTools from "./visuals.js";

const USER = { id: "u_user", email: "user@example.com", role: "user", emailVerified: true };
const testApp = await startTestApp({ users: [USER] });
const client = await mcpClient(testApp.port, testApp.keyFor(USER.id));
const imagegen = await import("../../routes/imagegen.js");

after(async () => {
  _setScopeForTests(null);
  imagegen._reset();
  await client.close().catch(() => {});
  await testApp.close();
});

const byName = Object.fromEntries(visualTools.map((t) => [t.name, t]));

/** A media folder for unit tests holding the given empty files. */
function mediaWith(...names) {
  const dir = fs.mkdtempSync(path.join(testApp.dataDir, "unit-media-"));
  for (const name of names) fs.writeFileSync(path.join(dir, name), "x");
  _setScopeForTests(async () => ({ outputDir: dir, sharedDir: path.join(dir, "none") }));
  return dir;
}

test("the visuals file declares its three tools on their routers", () => {
  assert.deepEqual(visualTools.map((t) => t.name), ["backgrounds_search", "library_items", "images_generate"]);
  assert.deepEqual(byName.backgrounds_search.routes, ["/api/pexels", "/api/pixabay"]);
  assert.deepEqual(byName.library_items.routes, ["/api/library", "/api/pexels", "/api/pixabay"]);
  assert.deepEqual(byName.images_generate.routes, ["/api/imagegen"]);
});

test("library_items says a library id works as a background in the render tools", () => {
  assert.match(byName.library_items.description, /library id/i);
  assert.match(byName.library_items.description, /background/i);
});

test("images_generate charges one image per image requested, defaulting to one", () => {
  const amount = byName.images_generate.caps.images;
  assert.equal(amount({}), 1);
  assert.equal(amount({ count: 3 }), 3);
  assert.equal(amount({ lines: ["a"], count: undefined }), 1);
});

// ---- backgrounds_search -----------------------------------------------------

const PEXELS_VIDEOS = [
  {
    id: 101, duration: 12, url: "https://www.pexels.com/video/101/", image: "https://img/101.jpg", previewUrl: "https://cdn/101-sd.mp4",
    files: [
      { id: 1, quality: "sd", width: 360, height: 640, link: "https://cdn/101-sd.mp4", file_type: "video/mp4" },
      { id: 2, quality: "hd", width: 1080, height: 1920, link: "https://cdn/101-hd.mp4", file_type: "video/mp4" },
    ],
  },
  { id: 102, duration: 8, url: "https://www.pexels.com/video/102/", image: "https://img/102.jpg", previewUrl: "https://cdn/102.mp4", files: [] },
];

test("backgrounds_search calls the chosen provider's search route and returns compact items", async () => {
  const { ctx, calls } = fakeMcpCtx({ "GET /api/pexels/search": { ok: true, videos: PEXELS_VIDEOS } });
  const result = await byName.backgrounds_search.handler(ctx, { source: "pexels", query: "sunrise" });
  assert.deepEqual(calls.map((c) => [c.method, c.path, c.opts.query]), [["GET", "/api/pexels/search", { q: "sunrise" }]]);
  assert.deepEqual(result.structuredContent, {
    source: "pexels",
    query: "sunrise",
    count: 2,
    items: [
      {
        id: "101", libraryId: "pexels_101", previewUrl: "https://cdn/101-sd.mp4", image: "https://img/101.jpg",
        pageUrl: "https://www.pexels.com/video/101/", durationSec: 12, width: 1080, height: 1920,
      },
      {
        id: "102", libraryId: "pexels_102", previewUrl: "https://cdn/102.mp4", image: "https://img/102.jpg",
        pageUrl: "https://www.pexels.com/video/102/", durationSec: 8, width: null, height: null,
      },
    ],
  });
});

test("backgrounds_search uses the pixabay route and trims to limit", async () => {
  const { ctx, calls } = fakeMcpCtx({ "GET /api/pixabay/search": { ok: true, videos: PEXELS_VIDEOS } });
  const result = await byName.backgrounds_search.handler(ctx, { source: "pixabay", query: "clouds", limit: 1 });
  assert.equal(calls[0].path, "/api/pixabay/search");
  assert.equal(result.structuredContent.items.length, 1);
  assert.equal(result.structuredContent.items[0].libraryId, "pixabay_101");
});

test("backgrounds_search tells the agent results are not in the library until downloaded", () => {
  assert.match(byName.backgrounds_search.description, /library_items/);
  assert.match(byName.backgrounds_search.description, /download/);
});

// ---- library_items ----------------------------------------------------------

const LIBRARY = {
  ok: true,
  library: {
    items: [
      { id: "pexels_101", provider: "pexels", url: "C:/srv/outputs/pexels-101.mp4", previewUrl: "/outputs/pexels-101.mp4", image: "/outputs/thumb-pexels-101.jpg", duration: 12, categories: ["sky", "peace"], searchQuery: "sunrise", savedAt: "2026-10-01T00:00:00Z" },
      { id: "local_9", url: "C:/srv/outputs/local-9.mp4", previewUrl: "/outputs/local-9.mp4", duration: 0, categories: ["urban"], title: "Street" },
    ],
  },
};

test("library_items list returns compact items without server file paths", async () => {
  const { ctx, calls } = fakeMcpCtx({ "GET /api/library": LIBRARY });
  const result = await byName.library_items.handler(ctx, { action: "list" });
  assert.equal(calls[0].path, "/api/library");
  const { items, total } = result.structuredContent;
  assert.equal(total, 2);
  assert.deepEqual(items[0], {
    id: "pexels_101", provider: "pexels", title: null, previewUrl: "http://host.test/outputs/pexels-101.mp4",
    image: "http://host.test/outputs/thumb-pexels-101.jpg", durationSec: 12, categories: ["sky", "peace"],
    searchQuery: "sunrise", savedAt: "2026-10-01T00:00:00Z",
  });
  assert.ok(!JSON.stringify(result.structuredContent).includes("C:/srv"));
});

test("library_items list filters by category and limits", async () => {
  const { ctx } = fakeMcpCtx({ "GET /api/library": LIBRARY });
  const sky = await byName.library_items.handler(ctx, { action: "list", category: "sky" });
  assert.deepEqual(sky.structuredContent.items.map((i) => i.id), ["pexels_101"]);
  assert.equal(sky.structuredContent.total, 1);
  const one = await byName.library_items.handler(ctx, { action: "list", limit: 1 });
  assert.equal(one.structuredContent.items.length, 1);
  assert.equal(one.structuredContent.total, 2);
});

test("library_items categories returns the category names", async () => {
  const { ctx } = fakeMcpCtx({ "GET /api/library/categories": { ok: true, categories: ["faith", "sky"] } });
  const result = await byName.library_items.handler(ctx, { action: "categories" });
  assert.deepEqual(result.structuredContent, { categories: ["faith", "sky"] });
});

test("library_items remove deletes by id and needs an id", async () => {
  const { ctx, calls } = fakeMcpCtx({ "DELETE /api/library/pexels_101": { ok: true } });
  const result = await byName.library_items.handler(ctx, { action: "remove", id: "pexels_101" });
  assert.deepEqual(result.structuredContent, { removed: "pexels_101" });
  assert.equal(calls[0].method, "DELETE");
  const missing = await byName.library_items.handler(ctx, { action: "remove" });
  assert.equal(missing.structuredContent.error, "BAD_INPUT");
});

test("library_items add sends only a resolved media path, never a raw item, and tags categories", async () => {
  const dir = mediaWith("clip.mp4");
  const { ctx, calls } = fakeMcpCtx({ "POST /api/library/add": { ok: true }, "PATCH /api/library/x/categories": { ok: true } });
  const patched = [];
  ctx.api.call = ((original) => async (method, route, opts) => {
    if (method === "PATCH") {
      patched.push({ route, opts });
      return { ok: true };
    }
    return original(method, route, opts);
  })(ctx.api.call);
  const result = await byName.library_items.handler(ctx, { action: "add", mediaPath: path.join(dir, "clip.mp4"), title: "My clip", categories: ["sky"] });
  const sent = calls.find((c) => c.method === "POST").opts.body;
  assert.match(sent.id, /^agent_[0-9a-f-]{36}$/);
  assert.equal(sent.url, fs.realpathSync(path.join(dir, "clip.mp4")));
  assert.equal(sent.title, "My clip");
  assert.deepEqual(Object.keys(sent).sort(), ["id", "title", "url"]);
  assert.deepEqual(patched, [{ route: `/api/library/${sent.id}/categories`, opts: { body: { categories: ["sky"] } } }]);
  assert.equal(result.structuredContent.id, sent.id);
});

test("library_items add refuses a path outside the media folder, a URL and a non-video", async () => {
  const dir = mediaWith("notes.txt");
  const { ctx, calls } = fakeMcpCtx({});
  const outside = await byName.library_items.handler(ctx, { action: "add", mediaPath: path.join(testApp.dataDir, "users.json") });
  assert.equal(outside.structuredContent.error, "PATH_OUTSIDE_MEDIA");
  const url = await byName.library_items.handler(ctx, { action: "add", mediaPath: "https://example.com/a.mp4" });
  assert.equal(url.structuredContent.error, "PATH_OUTSIDE_MEDIA");
  const text = await byName.library_items.handler(ctx, { action: "add", mediaPath: path.join(dir, "notes.txt") });
  assert.equal(text.structuredContent.error, "BAD_INPUT");
  const none = await byName.library_items.handler(ctx, { action: "add" });
  assert.equal(none.structuredContent.error, "BAD_INPUT");
  assert.equal(calls.length, 0);
});

test("library_items download saves a search result by provider id and returns the library item", async () => {
  const saved = { id: "pexels_101", provider: "pexels", url: "C:/srv/pexels-101.mp4", previewUrl: "/outputs/pexels-101.mp4", duration: 12, categories: ["sky"] };
  const { ctx, calls } = fakeMcpCtx({ "POST /api/pexels/download": { ok: true, file: "C:/srv/pexels-101.mp4", item: saved } });
  const result = await byName.library_items.handler(ctx, { action: "download", source: "pexels", sourceId: "101", query: "sunrise", durationSec: 12 });
  assert.deepEqual(calls[0].opts.body, { id: "101", searchQuery: "sunrise", duration: 12 });
  assert.equal(result.structuredContent.item.id, "pexels_101");
  assert.equal(result.structuredContent.item.previewUrl, "http://host.test/outputs/pexels-101.mp4");
  assert.ok(!JSON.stringify(result.structuredContent).includes("C:/srv"));
});

test("library_items download needs a numeric provider id and a source", async () => {
  const { ctx, calls } = fakeMcpCtx({});
  const noSource = await byName.library_items.handler(ctx, { action: "download", sourceId: "101" });
  assert.equal(noSource.structuredContent.error, "BAD_INPUT");
  const odd = await byName.library_items.handler(ctx, { action: "download", source: "pexels", sourceId: "../etc" });
  assert.equal(odd.structuredContent.error, "BAD_INPUT");
  assert.equal(calls.length, 0);
});

// ---- images_generate --------------------------------------------------------

test("images_generate posts the lines, aspect and count and returns url and path per image", async () => {
  const { ctx, calls } = fakeMcpCtx({
    "POST /api/imagegen/generate": {
      ok: true,
      generated: 1,
      failed: 1,
      items: [{ id: "C:/srv/outputs/genImg/g-1/part-1.png", publicUrl: "/outputs/genImg/g-1/part-1.png", kind: "image" }],
    },
  });
  const result = await byName.images_generate.handler(ctx, { lines: ["The Lord is my shepherd"], aspect: "square", count: 2 });
  assert.deepEqual(calls[0].opts.body, { lines: ["The Lord is my shepherd"], aspect: "square", count: 2 });
  assert.deepEqual(result.structuredContent, {
    images: [{ path: "/outputs/genImg/g-1/part-1.png", url: "http://host.test/outputs/genImg/g-1/part-1.png" }],
    generated: 1,
    failed: 1,
  });
});

test("images_generate leaves out aspect and count when not given", async () => {
  const { ctx, calls } = fakeMcpCtx({ "POST /api/imagegen/generate": { ok: true, generated: 0, failed: 0, items: [] } });
  await byName.images_generate.handler(ctx, { lines: ["x"] });
  assert.deepEqual(calls[0].opts.body, { lines: ["x"] });
});

// ---- through the real MCP server --------------------------------------------

test("tools/list shows the three visuals tools to a normal user", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const name of ["backgrounds_search", "library_items", "images_generate"]) assert.ok(names.includes(name), name);
});

test("library_items list and categories work for real on an empty library", async () => {
  const list = await client.callTool({ name: "library_items", arguments: { action: "list" } });
  assert.notEqual(list.isError, true, list.content?.[0]?.text);
  assert.deepEqual(list.structuredContent, { items: [], total: 0 });
  const categories = await client.callTool({ name: "library_items", arguments: { action: "categories" } });
  assert.ok(categories.structuredContent.categories.includes("faith"));
});

test("library_items add, list and remove round-trip through the real routes", async () => {
  const { resolveScopeDirs } = await import("../../lib/paths.js");
  _setScopeForTests(null);
  const outputDir = resolveScopeDirs({ sub: USER.id, email: USER.email, role: USER.role }).outputDir;
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "agent-bg.mp4"), "not really a video");
  const added = await client.callTool({ name: "library_items", arguments: { action: "add", mediaPath: path.join(outputDir, "agent-bg.mp4"), title: "Agent bg", categories: ["Sky", "sky", "Hope"] } });
  assert.notEqual(added.isError, true, added.content?.[0]?.text);
  const { id } = added.structuredContent;
  const listed = await client.callTool({ name: "library_items", arguments: { action: "list" } });
  const item = listed.structuredContent.items.find((i) => i.id === id);
  assert.ok(item, "the added item is listed");
  assert.deepEqual(item.categories, ["sky", "hope"]);
  const removed = await client.callTool({ name: "library_items", arguments: { action: "remove", id } });
  assert.deepEqual(removed.structuredContent, { removed: id });
  const after2 = await client.callTool({ name: "library_items", arguments: { action: "list" } });
  assert.ok(!after2.structuredContent.items.some((i) => i.id === id));
});

test("library_items add refuses a file outside the media folder through the real server", async () => {
  _setScopeForTests(null);
  const result = await client.callTool({ name: "library_items", arguments: { action: "add", mediaPath: path.join(testApp.dataDir, "users.json") } });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error, "PATH_OUTSIDE_MEDIA");
});

test("backgrounds_search with no provider key is a tool error", async () => {
  const saved = process.env.PEXELS_API_KEY;
  delete process.env.PEXELS_API_KEY;
  try {
    const result = await client.callTool({ name: "backgrounds_search", arguments: { source: "pexels", query: "sunrise" } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /PEXELS_API_KEY/);
  } finally {
    if (saved !== undefined) process.env.PEXELS_API_KEY = saved;
  }
});

test("images_generate through the real route returns the image and spends one image from the cap", async () => {
  imagegen._setEnabledImpl(() => true);
  imagegen._setGenerateImpl(async ({ seriesId }) => ({ ok: true, path: `C:/srv/outputs/genImg/${seriesId}/part-1.png`, publicUrl: `/outputs/genImg/${seriesId}/part-1.png` }));
  const before = await client.callTool({ name: "whoami", arguments: {} });
  const result = await client.callTool({ name: "images_generate", arguments: { lines: ["Be still and know"] } });
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  assert.equal(result.structuredContent.images.length, 1);
  assert.match(result.structuredContent.images[0].path, /^\/outputs\/genImg\/genvis-/);
  assert.match(result.structuredContent.images[0].url, /\/outputs\/genImg\/genvis-.*part-1\.png$/);
  const after2 = await client.callTool({ name: "whoami", arguments: {} });
  assert.equal(after2.structuredContent.caps.images.used, before.structuredContent.caps.images.used + 1);
});

test("images_generate when image generation is off is a tool error", async () => {
  imagegen._setEnabledImpl(() => false);
  const result = await client.callTool({ name: "images_generate", arguments: { lines: ["x"] } });
  assert.equal(result.isError, true);
});
