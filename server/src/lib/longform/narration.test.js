import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { narrateSections, chunkCacheKey } from "./narration.js";
import { probeAudioDurationSec } from "../story/storyRender.js";
import { longformTemplateById } from "./templates.js";
import { splitForProvider } from "./chunker.js";

function harness({ secondsPerChunk = 2, failOnCall = -1, available = { azure: { available: true } } } = {}) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "narr-"));
  const calls = { synth: [], ffmpeg: [] };
  const deps = {
    describeProviders: () => available,
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
      assert.equal(req.preferredProvider, "azure");
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
    assert.ok(progress.length >= 5, "expected a progress call per chunk plus the initial 0/total");
    const total = progress[0].total;
    assert.ok(total > 0);
    // The first call fires BEFORE any provider work so a caller can show
    // "(0/N)" immediately instead of a bare spinner until chunk one lands.
    assert.equal(progress[0].done, 0, "first call reports done === 0");
    progress.forEach((p, idx) => {
      assert.equal(p.total, total, "total stays stable across the whole run");
      assert.equal(p.done, idx, "done increases by one per chunk");
    });
    assert.equal(progress[progress.length - 1].done, total, "final call reports done === total");
  });
  test("onProgress carries the provider that actually voiced the chunks once known", async () => {
    const { workDir, deps } = harness();
    const progress = [];
    await narrateSections({ sections, template, voiceId: "v1", workDir }, { ...deps, onProgress: (p) => progress.push(p) });
    assert.equal(progress[0].provider, null, "provider unknown before the first chunk");
    assert.equal(progress[progress.length - 1].provider, "azure", "provider reported after chunks are voiced");
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
  test("honours a section's pauseBeforeMs (a [pause 8] in a pasted script) instead of the template pause", async () => {
    const { workDir, calls, deps } = harness();
    const probe = async (p) => { const m = /silence-(\d+)\.mp3$/.exec(path.basename(p)); return m ? Number(m[1]) / 1000 : 2; };
    const three = [sections[0], { ...sections[1], pauseBeforeMs: 8000, continuation: true }, { heading: "Close", reference: null, verseText: "", text: "Sleep well now.", targetSec: 30 }];
    const out = await narrateSections({ sections: three, template, voiceId: "v1", workDir }, { ...deps, probeDurationSec: probe });
    const list = fs.readFileSync(path.join(workDir, "concat.txt"), "utf8");
    assert.match(list, /silence-8000\.mp3/);
    assert.match(list, /silence-5000\.mp3/);
    assert.ok(calls.ffmpeg.some((a) => a.includes("anullsrc=r=44100:cl=mono") && a.includes("8.000")), "an 8 s silence file was generated");
    assert.equal(out.sections[1].startMs, out.sections[0].endMs + 8000);
    assert.equal(out.sections[2].startMs, out.sections[1].endMs + 5000);
  });
  test("a section with pauseBeforeMs 0 gets no silence at all", async () => {
    const { workDir, deps } = harness();
    const probe = async (p) => { const m = /silence-(\d+)\.mp3$/.exec(path.basename(p)); return m ? Number(m[1]) / 1000 : 2; };
    const two = [sections[0], { ...sections[1], pauseBeforeMs: 0, continuation: true }];
    const out = await narrateSections({ sections: two, template, voiceId: "v1", workDir }, { ...deps, probeDurationSec: probe });
    const list = fs.readFileSync(path.join(workDir, "concat.txt"), "utf8");
    assert.equal(/silence-/.test(list), false, "no silence file was concatenated");
    assert.equal(out.sections[1].startMs, out.sections[0].endMs, "the second section starts the moment the first ends");
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

  // C1 / M8 — every fresh chunk is transcoded into the cache (WAV from
  // Chatterbox/Piper would otherwise silently truncate the concat), and the
  // provider's own temp file is removed once the cache copy exists.
  test("transcodes each fresh chunk into the cache with libmp3lame and removes the provider file", async () => {
    const { workDir, calls, deps } = harness();
    await narrateSections({ sections, template, voiceId: "v1", workDir }, deps);
    const isTranscode = (a) => a[0] === "-y" && a[1] === "-i" && !a.includes("concat") && !a.includes("lavfi");
    const transcodes = calls.ffmpeg.filter(isTranscode);
    assert.equal(transcodes.length, calls.synth.length, "one transcode per fresh chunk");
    for (const args of transcodes) {
      assert.match(args[args.length - 1], /[\\/]chunks[\\/][a-f0-9]{40}\.mp3\.tmp$/, "output is the cache path (tmp, renamed after)");
      assert.deepEqual(args.slice(3, 9), ["-ar", "44100", "-ac", "1", "-c:a", "libmp3lame"]);
      assert.deepEqual(args.slice(-3, -1), ["-f", "mp3"], "explicit muxer: ffmpeg cannot infer one from .tmp");
    }
    for (let i = 1; i <= calls.synth.length; i++) {
      assert.equal(fs.existsSync(path.join(workDir, `tts-${i}.mp3`)), false, `provider file ${i} removed after caching`);
    }
    // A second run is fully cached: no synth, no further transcodes.
    const before = calls.ffmpeg.length;
    const synthBefore = calls.synth.length;
    await narrateSections({ sections, template, voiceId: "v1", workDir }, deps);
    assert.equal(calls.synth.length, synthBefore);
    assert.equal(calls.ffmpeg.slice(before).filter(isTranscode).length, 0, "no transcodes on cache hits");
  });

  // I1 — the template's provider order wins over registration order, but only
  // providers the orchestrator reports as configured are tried.
  test("honours the template's provider order, skipping providers that are not configured", async () => {
    const { workDir, calls, deps } = harness({ available: { elevenlabs: { available: true }, edge: { available: true } } });
    await narrateSections({ sections, template, voiceId: "v1", workDir }, deps);
    assert.ok(calls.synth.length > 0);
    for (const req of calls.synth) assert.equal(req.preferredProvider, "edge", "azure is skipped (unavailable); edge is next in template order");
  });
  test("falls back to the orchestrator's own default when none of the template's providers is configured", async () => {
    const { workDir, calls, deps } = harness({ available: { elevenlabs: { available: true } } });
    await narrateSections({ sections, template, voiceId: "v1", workDir }, deps);
    assert.ok(calls.synth.length > 0);
    for (const req of calls.synth) assert.equal("preferredProvider" in req, false, "no preferredProvider: let the orchestrator choose");
  });
  test("tries the next configured template provider when the first one fails", async () => {
    const { workDir, calls, deps } = harness({ available: { azure: { available: true }, edge: { available: true } } });
    const flaky = async (req) => {
      if (req.preferredProvider === "azure") throw new Error("azure down");
      return deps.synthesize(req);
    };
    const out = await narrateSections({ sections, template, voiceId: "v1", workDir }, { ...deps, synthesize: flaky });
    assert.ok(out.audioPath);
    assert.ok(calls.synth.length > 0);
    assert.ok(calls.synth.every((r) => r.preferredProvider === "edge"), "only edge calls reached the recording synthesize");
  });

  // M4 — chunks shorter than the orchestrator's 3-char minimum are skipped
  // and never counted in `total`.
  test("skips chunks shorter than 3 characters without counting them", async () => {
    const { workDir, calls, deps } = harness();
    const tiny = [
      { heading: "Tiny", reference: null, verseText: "", text: "Ok", targetSec: 20 },
      sections[0],
    ];
    const progress = [];
    const out = await narrateSections({ sections: tiny, template, voiceId: "v1", workDir }, { ...deps, onProgress: (p) => progress.push(p) });
    assert.equal(calls.synth.some((r) => r.text === "Ok"), false, "the sub-minimum chunk was not synthesised");
    assert.equal(progress[0].total, 1);
    assert.equal(out.sections.length, 2);
    assert.equal(out.sections[0].startMs, 0);
    assert.equal(out.sections[0].endMs, 0, "the tiny section contributes no audio");
  });

  // C1 end-to-end with the real ffmpeg: a WAV chunk from a provider must
  // survive the concat with its full duration.
  test("real ffmpeg: WAV provider output concatenates to the expected duration", async (t) => {
    const probeFf = spawnSync("ffmpeg", ["-version"]);
    const probeFp = spawnSync("ffprobe", ["-version"]);
    if (probeFf.error || probeFf.status !== 0 || probeFp.error || probeFp.status !== 0) { t.skip("ffmpeg/ffprobe not available"); return; }
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "narr-real-"));
    const wav = path.join(workDir, "tone.wav");
    const gen = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "pcm_s16le", wav]);
    assert.equal(gen.status, 0, gen.stderr?.toString());
    let n = 0;
    const deps = {
      describeProviders: () => ({ chatterbox: { available: true } }),
      synthesize: async () => {
        // Each call hands over its own copy: the module deletes the provider file after caching.
        const f = path.join(workDir, `prov-${++n}.wav`);
        fs.copyFileSync(wav, f);
        return { ok: true, file: f, provider: "chatterbox" };
      },
      probeDurationSec: probeAudioDurationSec,
    };
    const two = [
      { heading: "A", reference: null, verseText: "", text: "First section spoken text.", targetSec: 2 },
      { heading: "B", reference: null, verseText: "", text: "Second section spoken text.", targetSec: 2 },
    ];
    const out = await narrateSections({ sections: two, template, voiceId: "v1", workDir }, deps);
    const measured = await probeAudioDurationSec(out.audioPath);
    const expected = 2 + template.voice.pauseMs / 1000 + 2;
    assert.ok(Math.abs(measured - expected) <= 0.3, `narration.mp3 is ${measured}s, expected ~${expected}s`);
    assert.ok(Math.abs(out.durationMs / 1000 - expected) <= 0.3, `reported ${out.durationMs}ms`);
  });
});
