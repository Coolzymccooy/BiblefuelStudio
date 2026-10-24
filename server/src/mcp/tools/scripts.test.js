import { test, after } from "node:test";
import assert from "node:assert/strict";
import { startTestApp, mcpClient } from "../../../test/helpers/mcpTestApp.js";
import { fakeMcpCtx } from "../../../test/helpers/fakeMcpCtx.js";
import scriptsTools from "./scripts.js";

// No language-model keys: generateScripts then uses its built-in verse templates.
for (const name of ["OPENAI_API_KEY", "GEMINI_API_KEY", "OPENCODE_ENABLED"]) process.env[name] = "";

const USER = { id: "u_user", email: "user@example.com", role: "user", emailVerified: true };
const testApp = await startTestApp({ users: [USER] });
const client = await mcpClient(testApp.port, testApp.keyFor(USER.id));

after(async () => {
  await client.close().catch(() => {});
  await testApp.close();
});

const byName = Object.fromEntries(scriptsTools.map((t) => [t.name, t]));

test("scripts_generate posts the fields it was given and returns the scripts without the ok flag", async () => {
  const scripts = [{ title: "T", hook: "H", verse: "V", reference: "John 3:16", reflection: "R", cta: "C", hashtags: ["#a"] }];
  const { ctx, calls } = fakeMcpCtx({ "POST /api/scripts/generate": { ok: true, scripts } });
  const result = await byName.scripts_generate.handler(ctx, { count: 3, scriptType: "peace", ctaStyle: "save" });
  assert.deepEqual(result.structuredContent, { scripts });
  assert.deepEqual(calls[0].opts.body, { count: 3, scriptType: "peace", ctaStyle: "save" });
});

test("scripts_generate drops undefined fields so the route defaults apply", async () => {
  const { ctx, calls } = fakeMcpCtx({ "POST /api/scripts/generate": { ok: true, scripts: [] } });
  await byName.scripts_generate.handler(ctx, { niche: undefined, count: 2 });
  assert.deepEqual(calls[0].opts.body, { count: 2 });
});

test("scripts_generate has no cap bucket and maps /api/scripts", () => {
  assert.equal(byName.scripts_generate.caps, undefined);
  assert.deepEqual(byName.scripts_generate.routes, ["/api/scripts"]);
  assert.match(byName.scripts_generate.description, /scripts/i);
});

test("bible_lookup verse sends reference and translation to /verse", async () => {
  const body = { ok: true, reference: "John 3:16", translation: "kjv", verses: [{ verse: 16, text: "For God so loved" }], source: "x", youversion: { url: "u" } };
  const { ctx, calls } = fakeMcpCtx({ "GET /api/bible/verse": body });
  const result = await byName.bible_lookup.handler(ctx, { mode: "verse", reference: "John 3:16", translation: "kjv" });
  assert.deepEqual(calls[0], { method: "GET", path: "/api/bible/verse", opts: { query: { reference: "John 3:16", translation: "kjv" } } });
  assert.equal(result.structuredContent.verses.length, 1);
  assert.equal("ok" in result.structuredContent, false);
});

test("bible_lookup parse calls /parse and translations calls /translations", async () => {
  const { ctx, calls } = fakeMcpCtx({
    "GET /api/bible/parse": { ok: true, reference: { canonical: "John 3:16" } },
    "GET /api/bible/translations": { ok: true, translations: [{ id: "kjv" }], youversion: [] },
  });
  const parsed = await byName.bible_lookup.handler(ctx, { mode: "parse", reference: "jn 3:16" });
  assert.equal(parsed.structuredContent.reference.canonical, "John 3:16");
  const list = await byName.bible_lookup.handler(ctx, { mode: "translations" });
  assert.equal(list.structuredContent.translations[0].id, "kjv");
  assert.equal(calls[1].path, "/api/bible/translations");
  assert.equal(calls[1].opts.query, undefined);
});

test("bible_lookup verse or parse without a reference is BAD_INPUT and calls nothing", async () => {
  const { ctx, calls } = fakeMcpCtx({});
  for (const mode of ["verse", "parse"]) {
    const result = await byName.bible_lookup.handler(ctx, { mode });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.error, "BAD_INPUT");
  }
  assert.equal(calls.length, 0);
});

test("tools/list shows scripts_generate and bible_lookup", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  assert.ok(names.includes("scripts_generate"));
  assert.ok(names.includes("bible_lookup"));
});

test("scripts_generate really runs through the route with the built-in templates", async () => {
  const result = await client.callTool({ name: "scripts_generate", arguments: { count: 2, scriptType: "peace" } });
  assert.notEqual(result.isError, true);
  assert.equal(result.structuredContent.scripts.length, 2);
  assert.equal(typeof result.structuredContent.scripts[0].hook, "string");
  assert.equal("ok" in result.structuredContent, false);
});

test("scripts_generate refuses a count above 100 before the route", async () => {
  const result = await client.callTool({ name: "scripts_generate", arguments: { count: 500 } });
  assert.equal(result.isError, true);
});

test("bible_lookup parse works for real, and a verse miss is a tool error", async () => {
  const parsed = await client.callTool({ name: "bible_lookup", arguments: { mode: "parse", reference: "John 3:16" } });
  assert.notEqual(parsed.isError, true);
  assert.equal(parsed.structuredContent.reference.chapter, 3);
  const bad = await client.callTool({ name: "bible_lookup", arguments: { mode: "parse", reference: "zzzz" } });
  assert.equal(bad.isError, true);
});

test("bible_lookup translations lists translations", async () => {
  const result = await client.callTool({ name: "bible_lookup", arguments: { mode: "translations" } });
  assert.notEqual(result.isError, true);
  assert.ok(Array.isArray(result.structuredContent.translations));
});
