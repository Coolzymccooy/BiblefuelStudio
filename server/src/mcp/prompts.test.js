import { test, after } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { startTestApp, mcpClient } from "../../test/helpers/mcpTestApp.js";
import { PROMPTS } from "./prompts.js";

// The three canned step lists. Their text must only ever name tools that exist, so an agent
// following one never calls a tool the server does not have.

const USERS = [{ id: "u_user", email: "user@example.com", role: "user", emailVerified: true }];
const testApp = await startTestApp({ users: USERS });
// Imported after startTestApp: server modules read env (DATA_DIR) at import time.
const { catalogue } = await import("./registry.js");
const client = await mcpClient(testApp.port, testApp.keyFor("u_user"));

after(async () => {
  await client.close().catch(() => {});
  await testApp.close();
});

const NAMES = ["make_short_from_verse", "make_ambient_session", "make_lyric_video"];

/** Every argument combination worth checking, per prompt (publish on shows the most tools). */
const VARIANTS = {
  make_short_from_verse: [
    { reference: "John 3:16" },
    { reference: "John 3:16", voice: "en-US-GuyNeural", publish: "true" },
    { reference: "Psalm 23:1-3", publish: "false" },
  ],
  make_ambient_session: [{}, { theme: "rest", hours: "3" }, { hours: "10" }],
  make_lyric_video: [{ songPath: "/outputs/u_user/song.mp3" }, { songPath: "https://example.com/song.mp3" }],
};

const PUBLISHING_TOOLS = ["publish_youtube", "publish_post", "schedules", "autopublish_run", "series_generate", "youtube_thumbnail"];

const promptDef = (name) => PROMPTS.find((p) => p.name === name);

/** Every `name` code span in the text that is a bare identifier: by the prompts' convention, a tool name. */
function toolNamesIn(text) {
  return [...text.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)*)`/g)].map((m) => m[1]);
}

/** Positions of the given tools' first mention, which must rise in the order given. */
function assertOrder(text, names) {
  const at = names.map((name) => text.indexOf(`\`${name}\``));
  at.forEach((pos, i) => assert.ok(pos >= 0, `${names[i]} is not mentioned`));
  for (let i = 1; i < at.length; i += 1) assert.ok(at[i - 1] < at[i], `${names[i - 1]} should come before ${names[i]}`);
}

async function getText(name, args) {
  const result = await client.getPrompt({ name, arguments: args });
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].role, "user");
  assert.equal(result.messages[0].content.type, "text");
  return result.messages[0].content.text;
}

test("prompts/list shows the three prompts with their arguments, to a plain user's key", async () => {
  const { prompts } = await client.listPrompts();
  assert.deepEqual(prompts.map((p) => p.name).sort(), [...NAMES].sort());
  const args = Object.fromEntries(prompts.map((p) => [p.name, (p.arguments || []).map((a) => `${a.name}${a.required ? "!" : "?"}`)]));
  assert.deepEqual(args.make_short_from_verse, ["reference!", "voice?", "publish?"]);
  assert.deepEqual(args.make_ambient_session, ["theme?", "hours?"]);
  assert.deepEqual(args.make_lyric_video, ["songPath!"]);
  for (const prompt of prompts) assert.ok(prompt.description, `${prompt.name} has a description`);
});

test("make_short_from_verse renders the reference and the steps in order, without publishing", async () => {
  const text = await getText("make_short_from_verse", { reference: "John 3:16" });
  assert.match(text, /"John 3:16"/);
  assertOrder(text, ["whoami", "bible_lookup", "voice_synthesize", "render_short", "jobs_wait"]);
  assert.match(text, /kind: "job"/);
  for (const tool of PUBLISHING_TOOLS) assert.ok(!toolNamesIn(text).includes(tool), `${tool} is not a step without publish`);
  assert.match(text, /auto-publish/, "says a consented key with auto-publish on posts by itself");
  assert.match(text, /renderAutoPublish\.enabled/);
  assertOrder(text, ["social_status", "render_short"]);
});

test("make_short_from_verse with publish adds the YouTube steps and says consent must be on", async () => {
  const text = await getText("make_short_from_verse", { reference: "John 3:16", voice: "en-US-GuyNeural", publish: "true" });
  // L5: a voice id only means something with the provider whose voice_list holds it.
  assert.match(text, /voiceId: "en-US-GuyNeural", provider: <the provider/);
  assertOrder(text, ["voice_list", "voice_synthesize"]);
  // H1: auto-publish is read before anything is spent, so a render that posts by itself is never uploaded again.
  assertOrder(text, ["whoami", "social_status", "bible_lookup", "render_short", "jobs_wait"]);
  assert.ok(text.indexOf("`publish_youtube` with") > text.indexOf("`render_short` with"), "the upload comes after the render");
  assert.match(text, /renderAutoPublish\.enabled/);
  assert.match(text, /at least 1 publishes remaining/);
  assert.match(text, /twice/);
  assert.match(text, /youtube\.connected/);
  const publishStep = text.split("\n").find((line) => line.includes("`publish_youtube` with"));
  assert.match(publishStep, /^\d+\. Only if auto-publish is off/, "the upload step is skipped when the render posts by itself");
  assert.match(text, /kind: "publish"/);
  assert.match(text, /publishAllowed/);
  assert.match(text, /This key may publish/);
  assert.match(text, /PUBLISH_NOT_ALLOWED/);
});

test("make_ambient_session renders the theme and length, and never publishes", async () => {
  const text = await getText("make_ambient_session", { theme: "rest", hours: "3" });
  assert.match(text, /theme: "rest"/);
  assert.match(text, /targetSec: 10800/);
  assert.match(text, /About 12 verses/);
  assertOrder(text, ["whoami", "ambient_project", "ambient_plan", "music_library", "ambient_update", "ambient_step", "ambient_render", "ambient_cancel"]);
  assert.match(text, /kind: "ambient"/);
  const defaults = await getText("make_ambient_session", {});
  assert.match(defaults, /targetSec: 7200/);
  assert.doesNotMatch(defaults, /theme: /);
});

test("make_lyric_video renders the song path and the steps in order, and never publishes", async () => {
  const text = await getText("make_lyric_video", { songPath: "/outputs/u_user/song.mp3" });
  assert.match(text, /path: "\/outputs\/u_user\/song\.mp3"/);
  assertOrder(text, ["whoami", "lyric_project", "lyric_set_song", "lyric_set_lyrics", "lyric_align", "lyric_render"]);
  assert.match(text, /kind: "lyric_render"/);
  assert.match(text, /projectId/);
  assert.match(text, /never invent/i);
});

test("a missing required argument is an error", async () => {
  await assert.rejects(client.getPrompt({ name: "make_short_from_verse", arguments: {} }), /reference/);
  await assert.rejects(client.getPrompt({ name: "make_lyric_video", arguments: {} }), /songPath/);
});

test("a bad optional argument is an error", async () => {
  await assert.rejects(client.getPrompt({ name: "make_short_from_verse", arguments: { reference: "John 3:16", publish: "maybe" } }), /publish/);
  for (const hours of ["0", "11", "two", "-1"]) {
    await assert.rejects(client.getPrompt({ name: "make_ambient_session", arguments: { hours } }), /hours/, `hours ${hours}`);
  }
});

test("every tool a prompt names is a registered tool open to every key, or a plan-feature tool the prompt says it needs", async () => {
  const byName = new Map(catalogue().map((def) => [def.name, def]));
  for (const name of NAMES) {
    for (const args of VARIANTS[name]) {
      const text = promptDef(name).render(parseArgs(name, args));
      const mentioned = toolNamesIn(text);
      assert.ok(mentioned.length >= 4, `${name} names its tools in code spans`);
      for (const tool of mentioned) {
        assert.ok(byName.has(tool), `${name} names ${tool}, which is not a registered tool`);
        const requires = byName.get(tool).requires;
        if (requires === undefined) continue;
        // A plan-gated tool is allowed only when the prompt names the feature and says what to do without it.
        assert.ok(requires.startsWith("feature:"), `${name} needs ${tool}, which only ${requires} keys see`);
        assert.ok(text.includes(`${requires.slice("feature:".length)} feature`), `${name} needs ${tool} (${requires}) without saying so`);
      }
    }
  }
});

test("every prompt points at the guide, the job handles and the stops", () => {
  for (const name of NAMES) {
    const text = promptDef(name).render(parseArgs(name, VARIANTS[name][0]));
    assert.match(text, /biblefuel:\/\/guide/, `${name} points at the guide`);
    assert.match(text, /`jobs_wait`/, `${name} waits on job handles`);
    for (const code of ["MCP_CAP_REACHED", "QUOTA_EXCEEDED"]) assert.match(text, new RegExp(code), `${name} says ${code} stops the run`);
  }
});

/** The arguments as the SDK hands them to the prompt: parsed by its own schema. */
function parseArgs(name, args) {
  return z.object(promptDef(name).argsSchema).parse(args);
}

// L6: each prompt says what whoami must show before the first paid step.
test("make_lyric_video asks whoami for 2 renders, and 1 imports only for a web address; lineId comes from lyric_project get", async () => {
  const local = await getText("make_lyric_video", { songPath: "/outputs/u_user/song.mp3" });
  const whoamiLine = (text) => text.split("\n").find((line) => line.includes("`whoami`"));
  assert.match(whoamiLine(local), /at least 2 renders remaining/);
  assert.doesNotMatch(whoamiLine(local), /imports/);
  const remote = await getText("make_lyric_video", { songPath: "https://example.com/song.mp3" });
  assert.match(whoamiLine(remote), /at least 2 renders and 1 imports remaining/);
  assert.match(local, /lineId: <[^>]*`lyric_project` with \{ action: "get"/);
});

test("make_ambient_session asks whoami for 1 render as well as the tts and images it plans", async () => {
  const text = await getText("make_ambient_session", { hours: "3" });
  const whoamiLine = text.split("\n").find((line) => line.includes("`whoami`"));
  assert.match(whoamiLine, /at least 1 renders, 12 tts and 12 images remaining/);
});

test("make_short_from_verse joins a reference a client split on its space (Claude Code: /prompt Romans 8:28)", async () => {
  for (const args of [{ reference: "Romans", voice: "8:28" }, { reference: "\"Romans", voice: "8:28\"" }, { reference: "1 John", voice: "4:8" }]) {
    const text = await getText("make_short_from_verse", args);
    const expected = `${args.reference.replace(/"/g, "")} ${args.voice.replace(/"/g, "")}`;
    assert.match(text, new RegExp(`reference: "${expected}"`), `${JSON.stringify(args)} reads as ${expected}`);
    assert.ok(!/voiceId: "/.test(text), "the verse number is not taken as a voice");
  }
  const voiced = await getText("make_short_from_verse", { reference: "John 3:16", voice: "en-US-GuyNeural" });
  assert.match(voiced, /voiceId: "en-US-GuyNeural"/, "a real voice is kept");
});

test("make_short_from_verse offers stock backgrounds when fewer than 4 images are left", async () => {
  const text = await getText("make_short_from_verse", { reference: "John 3:16" });
  assert.match(text, /fewer than 4 images/);
  assertOrder(text, ["whoami", "library_items", "render_short"]);
  assert.match(text, /`backgrounds_search`/);
  assert.match(text, /backgrounds: \[/);
});
