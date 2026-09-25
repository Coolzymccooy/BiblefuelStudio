import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { friendlyRenderError } from "../../src/lib/renderErrors.js";

describe("friendlyRenderError — maps ffmpeg failures to human messages", () => {
  test("argument/option errors -> server-side config message (not user's fault)", () => {
    const msg = friendlyRenderError(1, "Unrecognized option '/filter_complex'.\nError splitting the argument list: Option not found");
    assert.match(msg, /our side|internal/i);
    assert.match(msg, /ref: render-config/);
  });

  test("input decode errors -> re-upload message", () => {
    const msg = friendlyRenderError(1, "real.wav: No such file or directory");
    assert.match(msg, /re-upload|couldn't read/i);
    assert.match(msg, /ref: render-input/);
  });

  test("OOM errors -> fewer/smaller backgrounds message", () => {
    const msg = friendlyRenderError(1, "av_malloc: Cannot allocate memory");
    assert.match(msg, /memory/i);
    assert.match(msg, /ref: render-memory/);
  });

  test("caption/font errors -> captions message", () => {
    const msg = friendlyRenderError(1, "[Parsed_drawtext_1] Cannot load default font");
    assert.match(msg, /caption/i);
    assert.match(msg, /ref: render-captions/);
  });

  test("stream-wiring errors -> invalid-setup message", () => {
    // "matches no streams" is deliberately intercepted by the earlier
    // render-filtergraph branch (image-only timelines referencing [0:a]) —
    // see renderErrors.filtergraph.test.js for the full scenario.
    const msg = friendlyRenderError(1, "Stream specifier 'a1' matches no streams.");
    assert.match(msg, /combination of clips/i);
    assert.match(msg, /ref: render-filtergraph/);
  });

  test("compose failures -> combine message", () => {
    const msg = friendlyRenderError(1, "Error reinitializing filters!");
    assert.match(msg, /combine|background/i);
    assert.match(msg, /ref: render-compose/);
  });

  test("unknown failure -> generic fallback with exit code", () => {
    const msg = friendlyRenderError(137, "some unexpected output");
    assert.match(msg, /failed/i);
    assert.match(msg, /ref: render-exit-137/);
  });

  test("never leaks raw ffmpeg internals to the user", () => {
    const msg = friendlyRenderError(1, "ffmpeg version 5.1 libavcodec 59.37.100 Unrecognized option '/filter_complex'");
    assert.doesNotMatch(msg, /libav|ffmpeg version|filter_complex/i);
  });
});
