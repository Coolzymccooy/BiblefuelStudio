import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { _reset, register } from "../../src/lib/voice/registry.js";
import {
  synthesize,
  _setAlignmentImpl,
  _resetAlignmentImpl,
} from "../../src/lib/voice/orchestrator.js";

afterEach(() => { _resetAlignmentImpl(); _reset(); });

const baseCaps = {
  wordTimestamps: false,
  charTimestamps: false,
  emotionControls: false,
  ssml: false,
  streaming: false,
};

function fakeProvider(id, opts = {}) {
  return {
    id,
    isAvailable: () => true,
    capabilities: () => ({ ...baseCaps, ...(opts.caps || {}) }),
    synthesize: async () => ({
      ok: true,
      file: `/tmp/${id}.mp3`,
      provider: id,
      voice: "v",
      ...(opts.alignment ? { alignment: opts.alignment } : {}),
      ...(opts.words !== undefined ? { words: opts.words } : {}),
    }),
  };
}

test("forced-alignment off (default) — orchestrator does not call alignment", async () => {
  _reset();
  register(fakeProvider("edge"));

  let called = false;
  _setAlignmentImpl(
    async () => { called = true; return { characters: ["x"], starts: [0], ends: [0.1] }; },
    () => true,
  );

  const r = await synthesize({ text: "hello world", withTimestamps: true });
  assert.equal(called, false, "alignment must not run unless forcedAlignmentFallback is true");
  assert.equal(r.alignment, undefined);
  _resetAlignmentImpl();
});

test("forced-alignment on, provider gives no alignment — orchestrator fills it from whisper", async () => {
  _reset();
  register(fakeProvider("edge"));

  let called = false;
  _setAlignmentImpl(
    async () => {
      called = true;
      return { characters: ["h", "i", "!"], starts: [0, 0.1, 0.2], ends: [0.1, 0.2, 0.2] };
    },
    () => true,
  );

  const r = await synthesize({
    text: "hi!",
        withTimestamps: true,
        forcedAlignmentFallback: true,
      });
      assert.equal(called, true);
  assert.deepEqual(r.alignment.characters, ["h", "i", "!"]);
  assert.equal(r.alignmentSource, "whisper");
  _resetAlignmentImpl();
});

test("forced-alignment on, provider already gave alignment — orchestrator skips whisper", async () => {
  _reset();
  register(fakeProvider("elevenlabs", {
    alignment: { characters: ["h", "e", "y"], starts: [0, 0.1, 0.2], ends: [0.1, 0.2, 0.3] },
  }));

  let called = false;
  _setAlignmentImpl(async () => { called = true; return { characters: ["x"], starts: [0], ends: [0.1] }; }, () => true);

  const r = await synthesize({
    text: "hey",
    scriptureMode: false,
    withTimestamps: true,
    forcedAlignmentFallback: true,
  });
  assert.equal(called, false, "alignment must not run when provider already returned usable timing");
  assert.deepEqual(r.alignment.characters, ["h", "e", "y"]);
  assert.notEqual(r.alignmentSource, "whisper");
  _resetAlignmentImpl();
});

test("forced-alignment on but OPENAI_API_KEY missing — orchestrator skips silently", async () => {
  _reset();
  register(fakeProvider("edge"));

  let called = false;
  _setAlignmentImpl(async () => { called = true; return { characters: ["x"], starts: [0], ends: [0.1] }; }, () => false);

  const r = await synthesize({
    text: "hi there",
    withTimestamps: true,
    forcedAlignmentFallback: true,
  });
  assert.equal(called, false);
  assert.equal(r.alignment, undefined);
  _resetAlignmentImpl();
});

test("forced-alignment on, but withTimestamps not requested — orchestrator skips", async () => {
  _reset();
  register(fakeProvider("edge"));

  let called = false;
  _setAlignmentImpl(async () => { called = true; return { characters: ["x"], starts: [0], ends: [0.1] }; }, () => true);

  await synthesize({
    text: "hi there",
    withTimestamps: false,
    forcedAlignmentFallback: true,
  });
  assert.equal(called, false);
  _resetAlignmentImpl();
});

test("forced-alignment on, whisper returns null — orchestrator returns result without alignment", async () => {
  _reset();
  register(fakeProvider("edge"));

  _setAlignmentImpl(async () => null, () => true);

  const r = await synthesize({
    text: "hi there",
    withTimestamps: true,
    forcedAlignmentFallback: true,
  });
  assert.equal(r.alignment, undefined);
  assert.equal(r.ok, true);
  _resetAlignmentImpl();
});

const recovered = { characters: ["h", "e", "y"], starts: [0, 0.1, 0.2], ends: [0.1, 0.2, 0.3] };
const timingRequest = { text: "hey", scriptureMode: false, withTimestamps: true, forcedAlignmentFallback: true };

test("native Azure words bypass ASR and its availability check even without character alignment", async () => {
  for (const alignment of [undefined, {}, { characters: [], starts: [], ends: [] }, recovered]) {
    _reset();
    const words = [{ text: "hey", startMs: 0.125, endMs: 300.875 }];
    register(fakeProvider("azure", { caps: { wordTimestamps: true }, words, alignment }));
    _setAlignmentImpl(async () => { assert.fail("must not call ASR"); },
      () => { assert.fail("must not even check ASR availability"); });
    const result = await synthesize(timingRequest);
    assert.equal(result.words, words);
    assert.equal(result.alignmentSource, undefined);
  }
});

test("structurally valid subsets remain native evidence, not a completeness claim or ASR retry", async () => {
  const words = [{ text: "hey", startMs: 100, endMs: 200 }];
  register(fakeProvider("azure", { caps: { wordTimestamps: true }, words }));
  _setAlignmentImpl(async () => assert.fail("coverage is the caption caller's responsibility"),
    () => assert.fail("do not check ASR for structurally usable native timing"));
  const result = await synthesize({ ...timingRequest, text: "hey there friend" });
  assert.equal(result.words, words);
  assert.equal(result.alignment, undefined);
  assert.equal(result.alignmentSource, undefined, "do not relabel native evidence as script-forced or verified");
  assert.equal(result.words.length, 1, "orchestrator must not invent timing for missing script words");
});

test("empty native words with usable character timing bypass ASR", async () => {
  register(fakeProvider("elevenlabs", { words: [], alignment: recovered }));
  _setAlignmentImpl(async () => assert.fail("unnecessary ASR"), () => true);
  const result = await synthesize(timingRequest);
  assert.equal(result.alignment, recovered);
});

test("empty and malformed timing sources trigger ASR recovery", async () => {
  for (const source of [
    { alignment: {} }, { words: [] },
    { alignment: { characters: [], starts: [], ends: [] } },
    { alignment: { characters: ["x"], starts: [], ends: [1] } },
    { alignment: { characters: ["x"], starts: [NaN], ends: [1] } },
    { alignment: { characters: ["x"], starts: [0], ends: [0] } },
    { words: [{ text: "hey", startMs: 0, endMs: Infinity }] },
    { words: [{ text: "", startMs: 0, endMs: 100 }] },
  ]) {
    _reset();
    register(fakeProvider("edge", source));
    let calls = 0;
    _setAlignmentImpl(async (file, text) => {
      calls++;
      assert.equal(file, "/tmp/edge.mp3");
      assert.equal(text, "hey");
      return recovered;
    }, () => true);
    const result = await synthesize(timingRequest);
    assert.equal(calls, 1);
    assert.equal(result.alignment, recovered);
    // Backward compatible provenance is Whisper recognition, not script-forced.
    assert.equal(result.alignmentSource, "whisper");
  }
});

test("empty or malformed ASR output is not accepted as successful timing", async () => {
  for (const alignment of [{}, { characters: [], starts: [], ends: [] },
    { characters: ["x"], starts: [0], ends: [0] },
    { characters: ["x"], starts: [0], ends: [Infinity] }]) {
    _reset();
    register(fakeProvider("edge"));
    _setAlignmentImpl(async () => alignment, () => true);
    const result = await synthesize(timingRequest);
    assert.equal(result.ok, true);
    assert.equal(result.alignment, undefined);
    assert.equal(result.alignmentSource, undefined);
  }
});
