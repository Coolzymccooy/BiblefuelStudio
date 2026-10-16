import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeMusicPrompts, fallbackPrompt } from "./scenePrompts.js";
import { _setLlmImpl, _resetLlmImpl } from "../story/sceneSegmenter.js";

const SCENES = [
  { startMs: 0, endMs: 6000, kind: "instrumental", label: "Intro", text: "" },
  { startMs: 6000, endMs: 16000, kind: "verse", label: "Verse 1", text: "Everybody keeps running / when you become somebody" },
  { startMs: 16000, endMs: 26000, kind: "chorus", label: "Chorus", text: "Grace beyond the race" },
];
const MAN = "a young Black African man in his late twenties, short hair, plain olive shirt";

afterEach(() => _resetLlmImpl());

describe("writeMusicPrompts", () => {
  test("one LLM call gives one prompt per scene, in order", async () => {
    const asked = [];
    const llm = async (prompt) => { asked.push(prompt); return JSON.stringify({ prompts: ["dawn road", "running crowd", "open field"] }); };
    const prompts = await writeMusicPrompts({ title: "Grace Beyond the Race", artist: "Sthill Waters", scenes: SCENES, llm });
    assert.deepEqual(prompts, ["dawn road", "running crowd", "open field"]);
    assert.equal(asked.length, 1);
  });

  test("a bare JSON array, items given as objects, and fenced JSON are all read", async () => {
    const llm = async () => "```json\n[{\"imagePrompt\":\"a\"},{\"imagePrompt\":\"b\"},\"c\"]\n```";
    assert.deepEqual(await writeMusicPrompts({ title: "T", scenes: SCENES, llm }), ["a", "b", "c"]);
  });

  test("the request carries the song, every scene's lyrics and the rules", async () => {
    let asked = "";
    const llm = async (p) => { asked = p; return JSON.stringify({ prompts: ["a", "b", "c"] }); };
    await writeMusicPrompts({ title: "Grace Beyond the Race", artist: "Sthill Waters", scenes: SCENES, character: MAN, llm });
    assert.match(asked, /Grace Beyond the Race/);
    assert.match(asked, /Sthill Waters/);
    assert.match(asked, /when you become somebody/);
    assert.match(asked, /exactly 3/i);
    assert.match(asked, /no text/i);
    assert.match(asked, /chorus/i);
    assert.ok(asked.includes(MAN), "the character description is given to repeat");
    assert.match(asked, /repeat/i);
  });

  test("with no character the request speaks of the singer", async () => {
    let asked = "";
    const llm = async (p) => { asked = p; return JSON.stringify({ prompts: ["a", "b", "c"] }); };
    await writeMusicPrompts({ title: "T", scenes: SCENES, llm });
    assert.match(asked, /the singer/);
  });

  test("a wrong count falls back for every scene", async () => {
    const llm = async () => JSON.stringify({ prompts: ["only one"] });
    const prompts = await writeMusicPrompts({ title: "T", scenes: SCENES, character: MAN, llm });
    assert.deepEqual(prompts, SCENES.map((s) => fallbackPrompt(s, MAN)));
  });

  test("an LLM error or nonsense never fails: it falls back", async () => {
    for (const llm of [async () => { throw new Error("down"); }, async () => "not json", async () => ""]) {
      const prompts = await writeMusicPrompts({ title: "T", scenes: SCENES, llm });
      assert.deepEqual(prompts, SCENES.map((s) => fallbackPrompt(s, "")));
    }
  });

  test("an empty prompt in an otherwise good answer falls back for that scene only", async () => {
    const llm = async () => JSON.stringify({ prompts: ["a", "  ", "c"] });
    const prompts = await writeMusicPrompts({ title: "T", scenes: SCENES, llm });
    assert.deepEqual(prompts, ["a", fallbackPrompt(SCENES[1], ""), "c"]);
  });

  test("the fallback names the character, the section and the first lyric line", () => {
    assert.equal(fallbackPrompt(SCENES[1], MAN), `${MAN}, cinematic music video shot, Verse 1: Everybody keeps running`);
    assert.equal(fallbackPrompt(SCENES[0], ""), "cinematic music video shot, Intro");
    for (const s of SCENES) assert.ok(fallbackPrompt(s, MAN).startsWith(MAN), "the character is repeated in every scene");
  });

  test("by default it uses the segmenter's LLM helper, stubbed the same way", async () => {
    let calls = 0;
    _setLlmImpl(async () => { calls += 1; return JSON.stringify({ prompts: ["x", "y", "z"] }); });
    assert.deepEqual(await writeMusicPrompts({ title: "T", scenes: SCENES }), ["x", "y", "z"]);
    assert.equal(calls, 1);
  });

  test("no scenes, no call", async () => {
    let calls = 0;
    assert.deepEqual(await writeMusicPrompts({ title: "T", scenes: [], llm: async () => { calls += 1; return "[]"; } }), []);
    assert.equal(calls, 0);
  });
});
