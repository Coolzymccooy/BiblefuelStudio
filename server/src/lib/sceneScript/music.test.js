import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { suggestBed, withSuggestedBeds, isBedRef, resolveBed } from "./music.js";

describe("suggestBed", () => {
  test("matches the prototype's arc: reflective, warm, triumphant, soft", () => {
    const beds = withSuggestedBeds([
      { mood: "Emotional reflection", notes: "Soft piano, heartbeat" },
      { mood: "Grace revealed", notes: "warm strings, gospel chords" },
      { mood: "Victorious declaration", notes: "orchestral drums, brass" },
      { mood: "Music softens to piano and choir.", notes: "" },
    ]).map((c) => c.bed);
    assert.deepEqual(beds, ["library:reflective-acoustic", "library:cinematic-inspirational", "library:ascend-to-glory", "library:prayer-piano"]);
  });

  test("never suggests a vocal song and avoids repeating the previous bed", () => {
    const first = suggestBed({ mood: "Victory" });
    const second = suggestBed({ mood: "Victory again" }, first);
    assert.notEqual(first, second);
    assert.ok(!/gospel-|nothing-compares/.test(first + second));
  });

  test("keeps a bed the operator chose", () => {
    const [cue] = withSuggestedBeds([{ mood: "x", bed: "mylib:abc", bedSuggested: false }]);
    assert.equal(cue.bed, "mylib:abc");
    assert.equal(cue.bedSuggested, false);
  });

  test("accepts only library refs and resolves bundled beds", () => {
    assert.ok(isBedRef("library:prayer-piano"));
    assert.ok(!isBedRef("../../etc/passwd"));
    assert.ok(resolveBed("/nowhere", "library:prayer-piano")?.endsWith("02-prayer-piano.mp3"));
    assert.equal(resolveBed("/nowhere", "mylib:missing"), null);
  });
});
