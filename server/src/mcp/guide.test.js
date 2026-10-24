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
  // library_items actions, written as `add { ... }` and `remove { id }`.
  "add", "remove",
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

/** Names that are neither a registered tool, a prompt nor a listed value, each once. */
function unknownNames(spans) {
  const names = new Set([...toolNames(), ...PROMPTS.map((prompt) => prompt.name)]);
  return [...new Set(spans.filter((name) => !names.has(name) && !NOT_TOOLS.has(name)))];
}

const unknownMessage = (unknown, where) =>
  `${where}: ${unknown.map((name) => `"${name}"`).join(", ")} is not a tool, a prompt or a known value. ` +
  "Add it to NOT_TOOLS in guide.test.js if it is not a tool.";

test("every snake_case name in the guide is a registered tool, a prompt, or a known value", () => {
  const spans = [...GUIDE.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g)].map((m) => m[1]);
  const unknown = unknownNames(spans);
  assert.deepEqual(unknown, [], unknownMessage(unknown, "snake_case code span"));
});

// One-word tools (whoami, transcribe, branding...) have no underscore to spot them by, so check every name in a
// tool's place: the first span of a numbered step, and a span written as a call (`name { ... }` or `name` with { ... }).
test("every name the guide writes as a call or a step is a registered tool, a prompt, or a known value", () => {
  const spans = [
    ...[...GUIDE.matchAll(/^\s*\d+\. `([a-z][a-z0-9_]*)`/gm)].map((m) => m[1]),
    ...[...GUIDE.matchAll(/`([a-z][a-z0-9_]*) \{[^`]*`/g)].map((m) => m[1]),
    ...[...GUIDE.matchAll(/`([a-z][a-z0-9_]*)` with \{/g)].map((m) => m[1]),
  ];
  assert.ok(spans.includes("transcribe") && spans.includes("branding"), "one-word tools are found");
  const unknown = unknownNames(spans);
  assert.deepEqual(unknown, [], unknownMessage(unknown, "tool-position code span"));
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

test("Prompts has a row per prompt naming each of its own arguments as a code span", () => {
  const rows = section("## Prompts").split("\n");
  for (const prompt of PROMPTS) {
    const row = rows.find((line) => line.startsWith(`| \`${prompt.name}\` |`));
    assert.ok(row, `${prompt.name} has its own row`);
    for (const arg of Object.keys(prompt.argsSchema)) assert.ok(row.includes(`\`${arg}\``), `${prompt.name}'s row names \`${arg}\``);
  }
});

test("Troubleshooting covers the errors agents meet, by their real codes", () => {
  const text = section("## Troubleshooting");
  for (const needle of [
    /HTTP 401/, /scene script/i, /403/, /`MCP_CAP_REACHED`/, /`QUOTA_EXCEEDED`/, /`PATH_OUTSIDE_MEDIA`/,
    /`PUBLISH_NOT_ALLOWED`/, /time[sd]? out/, /deploy/i, /`failed`/,
  ]) {
    assert.match(text, needle);
  }
  assert.doesNotMatch(GUIDE, /MCP_CONSENT_REQUIRED/, "no such code: consent refusals are PUBLISH_NOT_ALLOWED");
});

test("Resources describes the real wire shape of a refused read", () => {
  const text = section("## Resources");
  assert.match(text, /MCP error -32602: BAD_KIND/, "the SDK prefixes the message");
  assert.match(text, /-32603/, "server errors are InternalError");
  assert.match(text, /data\.error/, "agents branch on data.error, not the message");
});

test("Resources says a captioned job of another user answers 403, while other kinds read as missing", () => {
  const text = section("## Resources");
  assert.match(text, /`captioned`[^.]*`HTTP_403`/);
  assert.match(section("## Troubleshooting"), /`HTTP_403`/);
});

test("the Prompts row for make_lyric_video counts the import a URL costs", () => {
  const row = section("## Prompts").split(/\r?\n/).find((line) => line.startsWith("| `make_lyric_video`"));
  assert.match(row, /`imports`/);
});

// ---- #121: a shorter agent guide, agent part first ----

const { guideParts, GUIDE_MARKER, SETUP_TITLE } = await import("./guide.js");
const parts = guideParts(GUIDE);
const KB = 1024;

test("the file has one marker: the agent part before it, the setup part after, and nothing is lost", () => {
  assert.equal(GUIDE.split(GUIDE_MARKER).length, 2, "exactly one marker");
  const words = (text) => text.replace(/\s+/g, " ").trim();
  assert.ok(parts.setup.startsWith(`${SETUP_TITLE}\n`));
  assert.equal(words(`${parts.agent} ${parts.setup.slice(SETUP_TITLE.length)}`), words(GUIDE.replace(GUIDE_MARKER, "")));
});

test("the agent part (biblefuel://guide) is under 30 KB", () => {
  const bytes = Buffer.byteLength(parts.agent);
  assert.ok(bytes < 30 * KB, `the agent guide is ${bytes} bytes; keep it under ${30 * KB}`);
});

test("the agent part runs first calls, the job handle, pipelines, costs, then errors and troubleshooting", () => {
  const order = ["## First calls", "## Waiting for jobs", "## Pipelines", "## Quotas and daily caps", "## Troubleshooting"];
  const at = order.map((heading) => parts.agent.split("\n").indexOf(heading));
  assert.ok(at.every((i) => i >= 0), `the agent part has every section: ${order.filter((_, i) => at[i] < 0).join(", ")}`);
  assert.deepEqual([...at].sort((a, b) => a - b), at, "in this order");
});

test("human setup (keys, connecting clients, Settings steps) is in the setup part only", () => {
  for (const heading of ["## Get a key", "## Connect Hermes Agent", "## Connect Codex", "## Connect Claude Code", "### Tools available today"]) {
    assert.equal(parts.agent.includes(heading), false, `${heading} is not in the agent part`);
    assert.ok(parts.setup.includes(heading), `${heading} is in the setup part`);
  }
});

test("both parts are served with LF line endings", () => {
  assert.equal(parts.agent.includes("\r"), false);
  assert.equal(parts.setup.includes("\r"), false);
});

test("the agent part tells agents about jobs_cancel, durationSec and the setup resource", () => {
  assert.match(parts.agent, /`jobs_cancel \{ kind, id, projectId\? \}`/);
  assert.match(parts.agent, /`durationSec`, the video's real length/);
  assert.match(parts.agent, /biblefuel:\/\/guide\/setup/);
});
