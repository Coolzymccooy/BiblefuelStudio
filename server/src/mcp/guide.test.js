import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// docs/mcp.md is the guide agents read (biblefuel://guide) and the Help page renders. It must
// list exactly the tools the server has, name no tool that does not exist, and cover the
// errors agents actually meet.

// Server modules read DATA_DIR at import time; keep this file's imports off the real data folder.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-guide-"));
process.env.DATA_DIR = dataDir;
process.env.OUTPUT_DIR = path.join(dataDir, "outputs");
process.env.JWT_SECRET ||= "mcp-guide-test-secret";
const { catalogue } = await import("./registry.js");
const { PROMPTS } = await import("./prompts.js");

after(() => fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 }));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GUIDE = fs.readFileSync(path.resolve(__dirname, "../../../docs/mcp.md"), "utf-8");

// Code spans in the guide that look like tool names but are values: job types, actions, phases, examples.
const NOT_TOOLS = new Set([
  "auto_generate", "bearer_token_env_var", "campaign_auto_post", "clean_voice", "making_shots", "mark_published",
  "pexels_123", "publish_draft", "render_video", "render_waveform", "timeline_preview", "cancel_render",
  "ready_to_render", "draft_script",
]);

/** The text of one `## ` or `### ` section, up to the next heading of the same or a higher level. */
function section(heading) {
  const level = heading.match(/^#+/)[0].length;
  const lines = GUIDE.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  assert.ok(start >= 0, `the guide has no "${heading}" section`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => {
    const m = /^(#+) /.exec(line);
    return m && m[1].length <= level;
  });
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

const toolNames = () => catalogue().map((def) => def.name);

test("the tool table lists every registered tool exactly once, and nothing else", () => {
  const rows = [...section("### Tools available today").matchAll(/^\| `([a-z0-9_]+)` \|/gm)].map((m) => m[1]);
  const duplicates = rows.filter((name, i) => rows.indexOf(name) !== i);
  assert.deepEqual(duplicates, [], "tools listed twice");
  assert.deepEqual([...rows].sort(), [...toolNames()].sort());
});

test("every tool-shaped name in the guide is a registered tool, a prompt, or a known value", () => {
  const names = new Set([...toolNames(), ...PROMPTS.map((prompt) => prompt.name)]);
  const spans = [...GUIDE.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g)].map((m) => m[1]);
  const unknown = [...new Set(spans.filter((name) => !names.has(name) && !NOT_TOOLS.has(name)))];
  assert.deepEqual(unknown, [], "the guide names tools that do not exist");
});

test("the guide no longer promises tools in later slices", () => {
  assert.doesNotMatch(GUIDE, /later slices|marked \*\*coming\*\*/i);
});

test("Resources covers the guide and the job template", () => {
  const text = section("## Resources");
  assert.match(text, /biblefuel:\/\/guide/);
  assert.match(text, /biblefuel:\/\/jobs\/\{kind\}\/\{id\}/);
  assert.match(text, /projectId/);
  assert.match(text, /jobs_get|jobs_wait/);
});

test("Prompts names the three prompts with their arguments", () => {
  const text = section("## Prompts");
  for (const prompt of PROMPTS) {
    assert.match(text, new RegExp(`\`${prompt.name}\``), `${prompt.name} is described`);
    for (const arg of Object.keys(prompt.argsSchema)) assert.match(text, new RegExp(`\\b${arg}\\b`), `${prompt.name} ${arg}`);
  }
});

test("Troubleshooting covers the errors agents meet, by their real codes", () => {
  const text = section("## Troubleshooting");
  for (const needle of [
    /HTTP 401/, /scene script/i, /403/, /`MCP_CAP_REACHED`/, /`QUOTA_EXCEEDED`/, /`PATH_OUTSIDE_MEDIA`/,
    /`PUBLISH_NOT_ALLOWED`/, /times out/, /deploy/i, /`failed`/,
  ]) {
    assert.match(text, needle);
  }
  assert.doesNotMatch(GUIDE, /MCP_CONSENT_REQUIRED/, "no such code: consent refusals are PUBLISH_NOT_ALLOWED");
});
