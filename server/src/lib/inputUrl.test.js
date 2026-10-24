import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isUrlLike } from "./inputUrl.js";

describe("isUrlLike", () => {
  test("every scheme-prefixed value is a URL, including forms ffmpeg accepts without //", () => {
    for (const value of [
      "http://example.com/a.mp4", "HTTPS://example.com/a", "http:/127.0.0.1:8080/x", "http:127.0.0.1/x",
      "https:/169.254.169.254/", "tcp://127.0.0.1:6379", "gopher://x", "ftp://x/a", "rtmp://x/live",
      "file:///etc/passwd", "concat:a.mp3|b.mp3", "data:audio/mp3;base64,AA", "subfile,,start,0,end,0,,:x",
      "mylib:0000", " http://padded.example/x ",
    ]) {
      assert.equal(isUrlLike(value), true, value);
    }
  });

  test("Windows drive paths, POSIX paths, relative paths and library ids are not URLs", () => {
    for (const value of [
      "C:\\Users\\x\\a.mp4", "c:/Users/x/a.mp4", "D:\\media\\b.wav", "/var/data/a.mp4", "/outputs/a.mp4",
      "outputs/a.mp4", "./outputs/a.mp4", "12345", "pexels_123", "", null, undefined,
    ]) {
      assert.equal(isUrlLike(value), false, String(value));
    }
  });
});
