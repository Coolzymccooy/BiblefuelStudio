import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { narrateSections, chunkCacheKey } from "./narration.js";
import { longformTemplateById } from "./templates.js";
import { splitForProvider } from "./chunker.js";

function harness({ secondsPerChunk = 2, failOnCall = -1 } = {}) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "narr-"));
  const calls = { synth: [], ffmpeg: [] };
  const deps = {
    synthesize: async (req) => {
      calls.synth.push(req);
      if (calls.synth.length === failOnCall) throw new Error("provider hiccup");
      const f = path.join(workDir, `tts-${calls.synth.length}.mp3`);
      fs.writeFileSync(f, "audio");
      return { ok: true, file: f, provider: "azure", voice: req.voiceId };
    },
    probeDurationSec: async (p) => (path.basename(p).startsWith("silence-") ? 5 : secondsPerChunk),
    runFfmpeg: async (args) => {
      calls.ffmpeg.push(args);
      const out = args[args.length - 1];
      fs.writeFileSync(out, "made");
    },
  };
  return { workDir, calls, deps };
}

const template = longformTemplateById("sleep-30");
const sections = [
  { heading: "Welcome", reference: null, verseText: "", text: "Rest now. You are held. Breathe slowly.", targetSec: 60 },
  { heading: "Psalm 23", reference: "Psalm 23:1", verseText: "The LORD is my shepherd.", text: "Psalm 23:1. The LORD is my shepherd. Let that settle.", targetSec: 120 },
];

describe("narrateSections", () => {
  test("synthesises every chunk, inserts pauses between sections and reports section timings", async () => {
    const { workDir, calls, deps } = harness();
    const out = await narrateSections({ sections, template: { ...template, voice: { ...template.voice, maxChunkChars: 25 } }, voiceId: "v1", workDir }, deps);
    assert.ok(calls.synth.length >= 4, "expected several chunks");
    for (const req of calls.synth) {
      assert.equal(req.voiceId, "v1");
      assert.deepEqual(req.prosody, { rate: "-15%" });
      assert.equal(req.preferredProvider, "chatterbox");
    }
    assert.equal(out.audioPath, path.join(workDir, "narration.mp3"));
    // section 1 starts at 0; section 2 starts after section-1 chunks + one 5s pause
    const s1Chunks = calls.synth.filter((r) => sections[0].text.includes(r.text.split(" ")[0])).length;
    assert.equal(out.sections[0].startMs, 0);
    assert.equal(out.sections[1].startMs, out.sections[0].endMs + 5000);
    assert.equal(out.durationMs, out.sections[1].endMs);
    assert.ok(s1Chunks > 0);
    const list = fs.readFileSync(path.join(workDir, "concat.txt"), "utf8");
    assert.match(list, /silence-5000\.mp3/);
    assert.equal(list.match(/silence-5000\.mp3/g).length, 1, "one pause between two sections");
  });
  test("reports onProgress once per chunk, with done increasing up to total", async () => {
    const { workDir, deps } = harness();
    const progress = [];
    await narrateSections(
      { sections, template: { ...template, voice: { ...template.voice, maxChunkChars: 25 } }, voiceId: "v1", workDir },
      { ...deps, onProgress: (p) => progress.push(p) },
    );
    assert.ok(progress.length >= 4, "expected a progress call per chunk");
    const total = progress[0].total;
    assert.ok(total > 0);
    progress.forEach((p, idx) => {
      assert.equal(p.total, total, "total stays stable across the whole run");
      assert.equal(p.done, idx + 1, "done increases by one per chunk");
    });
    assert.equal(progress[progress.length - 1].done, total, "final call reports done === total");
  });
  test("still fires onProgress for every chunk on a fully cached resume", async () => {
    const { workDir, calls, deps } = harness();
    await narrateSections({ sections, template, voiceId: "v1", workDir }, deps);
    const firstRunSynths = calls.synth.length;
    const progress = [];
    await narrateSections({ sections, template, voiceId: "v1", workDir }, { ...deps, onProgress: (p) => progress.push(p) });
    assert.equal(calls.synth.length, firstRunSynths, "second run was fully served from cache");
    assert.ok(progress.length > 0, "onProgress still fired even though every chunk was a cache hit");
    assert.equal(progress[progress.length - 1].done, progress[progress.length - 1].total);
  });
  test("resumes from cached chunks after a provider failure", async () => {
    const { workDir, calls, deps } = harness({ failOnCall: 2 });
    await assert.rejects(() => narrateSections({ sections, template, voiceId: "v1", workDir }, deps), /provider hiccup/);
    const firstRunSynths = calls.synth.length;
    const out = await narrateSections({ sections, template, voiceId: "v1", workDir }, deps);
    assert.ok(out.audioPath);
    // second run re-synthesised only what the first run did not cache
    assert.ok(calls.synth.length < firstRunSynths * 2, "cached chunks were not re-synthesised");
  });
  test("cache key changes with text, voice and rate", () => {
    const a = chunkCacheKey({ provider: "azure", voiceId: "v", rate: "-15%", text: "hi" });
    assert.notEqual(a, chunkCacheKey({ provider: "azure", voiceId: "v", rate: "-15%", text: "ho" }));
    assert.notEqual(a, chunkCacheKey({ provider: "azure", voiceId: "w", rate: "-15%", text: "hi" }));
    assert.notEqual(a, chunkCacheKey({ provider: "azure", voiceId: "v", rate: "0%", text: "hi" }));
    assert.match(a, /^[a-f0-9]{40}$/);
  });
  test("rejects empty sections with a named error", async () => {
    const { workDir, deps } = harness();
    await assert.rejects(() => narrateSections({ sections: [], template, voiceId: "v", workDir }, deps), /no sections/i);
  });
  test("rejects with a named error when a chunk's duration cannot be measured", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "narr-"));
    let chunkProbeCalls = 0;
    const deps = {
      synthesize: async (req) => {
        const f = path.join(workDir, `tts-${Math.random().toString(36).slice(2)}.mp3`);
        fs.writeFileSync(f, "audio");
        return { ok: true, file: f, provider: "azure", voice: req.voiceId };
      },
      // Mirrors the real probeAudioDurationSec: returns null (not a throw) on
      // ffprobe failure for the second chunk, everything else measures fine.
      probeDurationSec: async (p) => {
        if (path.basename(p).startsWith("silence-")) return 5;
        chunkProbeCalls += 1;
        return chunkProbeCalls === 2 ? null : 2;
      },
      runFfmpeg: async (args) => {
        const out = args[args.length - 1];
        fs.writeFileSync(out, "made");
      },
    };
    await assert.rejects(
      () => narrateSections({ sections, template, voiceId: "v1", workDir }, deps),
      /could not measure duration/
    );
  });
  test("ignores a stray .tmp cache file left by an interrupted run", async () => {
    const { workDir, calls, deps } = harness();
    const chunksDir = path.join(workDir, "chunks");
    fs.mkdirSync(chunksDir, { recursive: true });
    const provider = template.voice.preferredProviders[0];
    const firstChunkText = splitForProvider(sections[0].text, template.voice.maxChunkChars)[0];
    const key = chunkCacheKey({ provider, voiceId: "v1", rate: template.voice.rate, text: firstChunkText });
    // A truncated leftover from a hard-killed prior run — must NOT be treated as a cache hit.
    fs.writeFileSync(path.join(chunksDir, `${key}.mp3.tmp`), "partial-leftover");
    await narrateSections({ sections, template, voiceId: "v1", workDir }, deps);
    assert.equal(calls.synth[0].text, firstChunkText, "a fresh synth happened for the first chunk despite the stray .tmp file");
    assert.ok(fs.existsSync(path.join(chunksDir, `${key}.mp3`)), "the real cache file was written after synth");
  });
});
