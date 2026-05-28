/**
 * Confirm piperProvider is registered in the voice engine, sits between
 * fishAudioProvider (slot 3) and edgeProvider (slot 4-was, now 5) per the
 * original priority spec — cloud premium first, free local fallback (piper)
 * next, msedge/chatterbox tail last.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { list } = await import("../../src/lib/voice/index.js");

test("piper provider is registered", () => {
  const ids = list().map((p) => p.id);
  assert.ok(ids.includes("piper"), `expected 'piper' in ${JSON.stringify(ids)}`);
});

test("piper sits between fish and edge in registration order", () => {
  const ids = list().map((p) => p.id);
  const fishIdx = ids.indexOf("fish");
  const piperIdx = ids.indexOf("piper");
  const edgeIdx = ids.indexOf("edge");
  assert.ok(fishIdx >= 0 && piperIdx >= 0 && edgeIdx >= 0, `all three registered: ${JSON.stringify(ids)}`);
  assert.ok(fishIdx < piperIdx, `fish (${fishIdx}) should come before piper (${piperIdx})`);
  assert.ok(piperIdx < edgeIdx, `piper (${piperIdx}) should come before edge (${edgeIdx})`);
});

test("piper provider exposes the TTSProvider contract", () => {
  const piper = list().find((p) => p.id === "piper");
  assert.ok(piper, "piper registered");
  assert.equal(typeof piper.isAvailable, "function");
  assert.equal(typeof piper.capabilities, "function");
  assert.equal(typeof piper.synthesize, "function");
});
