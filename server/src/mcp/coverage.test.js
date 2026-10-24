import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Keeps the agent tools honest: every router the app mounts under /api must be
 * reachable by some MCP tool (its `routes`), or be deliberately excluded.
 * Slice 1 maps only part of the app, so PENDING lists the rest and may only
 * ever shrink.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_FILE = path.resolve(__dirname, "../../index.js");
const TOOLS_DIR = path.join(__dirname, "tools");

// Routers an agent must never reach, or that are not a creation feature.
const EXCLUDED = [
  "auth", "agent-keys", "admin", "access-requests", "billing",
  "stems-worker", "firebase", "abi", "postiz", "issues", "mcp",
];

// Creation routers no tool covers yet. This shrinks as slices 2-4 land: when a
// tool maps a router, delete it from here (the second assertion enforces it).
const PENDING = [
  "ambient", "audio", "audio-adv", "bible", "branding", "gumroad", "imagegen",
  "library", "longform", "lyric-video", "moments", "pexels", "pixabay", "queue",
  "scene-script", "scripts", "series", "tts", "transcripts", "visual-library",
];

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
