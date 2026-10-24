import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startTestApp, mcpClient } from "../../../test/helpers/mcpTestApp.js";

// L5 (R30): a render_short started by a key without publish consent is queued with auto-publish
// suppressed, and when that job FINISHES the worker really does not post it through Postiz, even
// though the user's own auto-publish is on. The renderer is faked; the queue, the worker's
// completion path and maybeAutoPublish are real.

const USER = { id: "u_autopost", email: "autopost@example.com", role: "user", emailVerified: true };
const testApp = await startTestApp({ users: [USER] });
const store = await import("../../lib/agentKeys/store.js");
const { resolveScopeDirs } = await import("../../lib/paths.js");
const { writeLibrary } = await import("../../lib/library.js");
const { writeSocialStore } = await import("../../lib/socialStore.js");
const { _setExecuteJobForTests } = await import("../../routes/jobs.js");

const savedEnv = { url: process.env.POSTIZ_URL, key: process.env.POSTIZ_API_KEY, base: process.env.PUBLIC_BASE_URL };
process.env.POSTIZ_URL = "http://127.0.0.1:1";
process.env.POSTIZ_API_KEY = "test-key";
process.env.PUBLIC_BASE_URL = "https://studio.example.test";

const { dataDir } = resolveScopeDirs({ sub: USER.id, email: USER.email, role: USER.role });
writeLibrary(dataDir, { items: [{ id: "pexels_77", url: "http://127.0.0.1:1/bg.mp4" }] });
writeSocialStore(dataDir, { postiz: { autoPublish: true, postizUserId: "pz_1", autoPublishPlatforms: ["tiktok"] } });

// The "posting job <id>" log line is the signal maybeAutoPublish tried to post (the Postiz client is not stubbable).
const posted = new Set();
const original = { log: console.log, warn: console.warn };
console.log = (...args) => {
  const match = /^\[AUTO-PUBLISH\] posting job (\S+)/.exec(String(args[0]));
  if (match) posted.add(match[1]);
};
console.warn = () => {};
_setExecuteJobForTests(async () => ({ outFile: path.join(testApp.dataDir, "outputs", "video-auto.mp4") }));

const clients = [];
after(async () => {
  _setExecuteJobForTests(null);
  console.log = original.log;
  console.warn = original.warn;
  for (const [name, value] of [["POSTIZ_URL", savedEnv.url], ["POSTIZ_API_KEY", savedEnv.key], ["PUBLIC_BASE_URL", savedEnv.base]]) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await Promise.all(clients.map((c) => c.close().catch(() => {})));
  await testApp.close();
});

async function clientFor(publishAllowed, name) {
  const made = store.createKey(USER.id, name);
  if (publishAllowed) store.updateKey(USER.id, made.key.id, { publishAllowed: true });
  const client = await mcpClient(testApp.port, made.plain);
  clients.push(client);
  return client;
}

function jobRow(id) {
  return JSON.parse(fs.readFileSync(path.join(testApp.dataDir, "jobs.json"), "utf-8")).jobs.find((j) => j.id === id);
}

/** Waits for the worker to finish the job (the decision to post is made in the same tick it is marked done). */
async function finished(id) {
  for (let i = 0; i < 200; i += 1) {
    const row = jobRow(id);
    if (row?.status === "done" || row?.status === "failed") return row;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`job ${id} never finished`);
}

async function renderShort(client) {
  const result = await client.callTool({ name: "render_short", arguments: { lines: ["Be still"], backgrounds: ["pexels_77"] } });
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  return result.structuredContent;
}

test("a render_short job from a key without consent finishes without auto-posting", async () => {
  const handle = await renderShort(await clientFor(false, "no consent"));
  assert.equal(handle.autoPublish, "suppressed");
  const row = await finished(handle.id);
  assert.equal(row.status, "done");
  assert.equal(row.suppressAutoPublish, true);
  assert.equal(posted.has(handle.id), false);
});

test("control: the same render from a key with consent does auto-post when it finishes", async () => {
  const handle = await renderShort(await clientFor(true, "consent"));
  assert.equal(handle.autoPublish, "on");
  const row = await finished(handle.id);
  assert.equal(row.status, "done");
  assert.equal(posted.has(handle.id), true);
});
