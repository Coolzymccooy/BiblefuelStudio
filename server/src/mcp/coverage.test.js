import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { catalogue } from "./registry.js";

/**
 * Keeps the agent tools honest: every router the app mounts under /api must be
 * reachable by some MCP tool (its `routes`), or be deliberately excluded.
 * Slices 1-4 mapped every creation router; only cartoon (shipped ahead of its
 * tools) is pending. A new router needs a tool, a reason to exclude it, or a
 * PENDING entry before it ships. The
 * whole catalogue stays at 75 tools or fewer (fold rather than add).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_FILE = path.resolve(__dirname, "../../index.js");
const TOOLS_DIR = path.join(__dirname, "tools");

// Routers an agent must never reach, or that are not a creation feature.
const EXCLUDED = [
  "auth", "agent-keys", "admin", "access-requests", "billing",
  "stems-worker", "firebase", "abi", "postiz", "issues", "mcp",
];

// Creation routers no tool covers yet. Cartoon mode ships its router before its
// agent tools; when a tool maps it, delete it from here (an assertion enforces it).
const PENDING = ["cartoon"];

// The most tools the catalogue may hold (tool-authoring.md).
const MAX_TOOLS = 75;

/** Every `app.use("/api/<name>"` mount in index.js, with either quote style. */
function mountedPrefixes() {
  const source = fs.readFileSync(INDEX_FILE, "utf-8");
  const names = [...source.matchAll(/app\.use\(\s*["']\/api\/([a-z0-9-]+)["']/g)].map((m) => m[1]);
  return [...new Set(names)].sort();
}

/** The /api/<name> prefixes any tool declares in `routes`, loaded the way the registry loads tools. */
async function mappedPrefixes() {
  const files = fs.readdirSync(TOOLS_DIR).filter((f) => f.endsWith(".js") && !f.endsWith(".test.js")).sort();
  const modules = await Promise.all(files.map((f) => import(pathToFileURL(path.join(TOOLS_DIR, f)).href)));
  const tools = modules.flatMap((m) => m.default);
  const missing = tools.filter((t) => !Array.isArray(t.routes) || t.routes.length === 0).map((t) => t.name);
  assert.deepEqual(missing, [], `tools without routes: ${missing.join(", ")}`);
  const prefixes = tools.flatMap((t) => t.routes).map((route) => {
    const match = /^\/api\/([a-z0-9-]+)$/.exec(route);
    assert.ok(match, `route "${route}" must be a bare /api/<name> prefix`);
    return match[1];
  });
  return new Set(prefixes);
}

test("index.js mounts the routers this test expects to find", () => {
  const mounted = mountedPrefixes();
  for (const name of ["media", "jobs", "mcp", "access-requests", "transcribe"]) {
    assert.ok(mounted.includes(name), `${name} not found by the mount parser`);
  }
});

test("every mounted /api router is excluded, mapped by a tool, or listed as pending", async () => {
  const mapped = await mappedPrefixes();
  const strays = mountedPrefixes().filter((name) => !EXCLUDED.includes(name) && !mapped.has(name) && !PENDING.includes(name));
  assert.deepEqual(strays, [], `mounted routers with no tool and not excluded or pending: ${strays.join(", ")}`);
});

test("PENDING lists only routers that are still unmapped", async () => {
  const mapped = await mappedPrefixes();
  const mounted = mountedPrefixes();
  const stale = PENDING.filter((name) => mapped.has(name) || EXCLUDED.includes(name) || !mounted.includes(name));
  assert.deepEqual(stale, [], `remove from PENDING (mapped, excluded or no longer mounted): ${stale.join(", ")}`);
});

test(`the catalogue holds at most ${MAX_TOOLS} tools`, () => {
  const count = catalogue().length;
  assert.ok(count > 0, "the catalogue loaded no tools");
  assert.ok(count <= MAX_TOOLS, `the catalogue has ${count} tools, more than ${MAX_TOOLS}: fold rather than add`);
});

test("EXCLUDED names are all mounted routers", () => {
  const mounted = mountedPrefixes();
  const unknown = EXCLUDED.filter((name) => !mounted.includes(name));
  assert.deepEqual(unknown, [], `excluded but not mounted: ${unknown.join(", ")}`);
});

test("the account routers agents must never act on carry refuseAgentCalls", () => {
  const lines = fs.readFileSync(INDEX_FILE, "utf-8").split(/\r?\n/);
  for (const name of ["admin", "access-requests"]) {
    const mount = lines.find((l) => l.startsWith(`app.use("/api/${name}"`) || l.startsWith(`app.use('/api/${name}'`));
    assert.ok(mount, `/api/${name} is mounted`);
    assert.match(mount, /refuseAgentCalls/, `/api/${name} mount carries refuseAgentCalls`);
  }
});

test("jobs_cancel declares the router of every kind it can cancel, and render_cancel is folded into it (#121)", async () => {
  const { CANCEL_ROUTES } = await import("./jobCancel.js");
  const { NORMALISERS } = await import("./jobs.js");
  const names = catalogue().map((def) => def.name);
  assert.equal(names.includes("render_cancel"), false, "render_cancel is folded into jobs_cancel");
  const jobsCancel = catalogue().find((def) => def.name === "jobs_cancel");
  assert.ok(jobsCancel, "jobs_cancel is in the catalogue");
  for (const kind of Object.keys(CANCEL_ROUTES)) {
    const router = /^\/api\/[a-z0-9-]+/.exec(NORMALISERS[kind].route("x1", "p1"))[0];
    assert.ok(jobsCancel.routes.includes(router), `jobs_cancel routes lack ${router} (kind ${kind})`);
  }
});
