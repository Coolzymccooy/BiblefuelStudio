import { test } from "node:test";
import assert from "node:assert/strict";

import { _reset, register } from "../../src/lib/voice/registry.js";
import {
  synthesize,
  _setAlignmentImpl,
  _resetAlignmentImpl,
} from "../../src/lib/voice/orchestrator.js";

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
      return { characters: ["h", "i"], starts: [0, 0.1], ends: [0.1, 0.2] };
    },
    () => true,
  );

  const r = await synthesize({
    text: "hi there",
    withTimestamps: true,
    forcedAlignmentFallback: true,
  });
  assert.equal(called, true);
  assert.deepEqual(r.alignment.characters, ["h", "i"]);
  assert.equal(r.alignmentSource, "whisper");
  _resetAlignmentImpl();
});

test("forced-alignment on, provider already gave alignment — orchestrator skips whisper", async () => {
  _reset();
  register(fakeProvider("elevenlabs", {
    alignment: { characters: ["a"], starts: [0], ends: [0.1] },
  }));

  let called = false;
  _setAlignmentImpl(async () => { called = true; return { characters: ["x"], starts: [0], ends: [0.1] }; }, () => true);

  const r = await synthesize({
    text: "hi there",
    withTimestamps: true,
    forcedAlignmentFallback: true,
  });
  assert.equal(called, false, "alignment must not run when provider already returned alignment");
  assert.deepEqual(r.alignment.characters, ["a"]);
  assert.notEqual(r.alignmentSource, "whisper");
  _resetAlignmentImpl();
});

test("forced-alignment on but OPENAI_API_KEY missing — orchestrator skips silently", async () => {
  _reset();
  register(fakeProvider("edge"));

  let called = false;
  _setAlignmentImpl(async () => { called = true; return { characters: ["x"], starts: [0], ends: [0] }; }, () => false);

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
  _setAlignmentImpl(async () => { called = true; return { characters: ["x"], starts: [0], ends: [0] }; }, () => true);

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
