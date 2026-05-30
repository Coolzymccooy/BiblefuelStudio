import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validatePayloadForEnqueue } from "../../src/routes/jobs.js";

describe("validatePayloadForEnqueue — render_video auto background", () => {
  test("accepts autoBackground payloads with no explicit background", () => {
    const result = validatePayloadForEnqueue("render_video", {
      autoBackground: true,
      lines: ["A mountain of strength", "Still ocean waters"],
      durationSec: 20,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
  });

  test("still requires lines[] even in auto mode", () => {
    const result = validatePayloadForEnqueue("render_video", {
      autoBackground: true,
      lines: [],
    });
    assert.equal(result.ok, false);
    assert.match(result.error || "", /lines\[\] required/);
  });

  test("without autoBackground a missing background is still rejected", () => {
    const result = validatePayloadForEnqueue("render_video", {
      lines: ["hello"],
    });
    assert.equal(result.ok, false);
    assert.match(result.error || "", /backgroundPath missing/);
  });
});
