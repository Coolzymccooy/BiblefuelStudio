import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { videoCodecArgs, amfAvailable, _setEncodersProbe, _resetEncodersProbe } from "./encoders.js";

describe("encoders", () => {
  afterEach(() => _resetEncodersProbe());

  test("cpu is today's x264 settings", () => {
    assert.deepEqual(videoCodecArgs("cpu"), ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23"]);
  });

  test("amf uses the AMD encoder at constant quality", () => {
    assert.deepEqual(videoCodecArgs("amf"), ["-c:v", "h264_amf", "-quality", "quality", "-rc", "cqp", "-qp_i", "22", "-qp_p", "24"]);
  });

  test("anything else is cpu", () => {
    assert.deepEqual(videoCodecArgs("nvenc"), videoCodecArgs("cpu"));
  });

  test("amf is available only when ffmpeg lists h264_amf", () => {
    _setEncodersProbe(() => " V....D h264_amf  AMD AMF H.264 Encoder");
    assert.equal(amfAvailable(), true);
    _setEncodersProbe(() => " V....D libx264  H.264");
    assert.equal(amfAvailable(), false);
  });
});
