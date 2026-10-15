import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  SEEDANCE_MODELS, NO_TEXT_LINE,
  isSeedanceConfigured, seedanceRatio, clampSeedanceDuration, withNoText,
  submitSeedanceTask, waitForSeedanceTask, downloadSeedanceVideo,
} from "./seedance.js";

const KEY = "ark-test-key-123";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
let saved;
let tmp;

beforeEach(() => {
  saved = { key: process.env.BYTEPLUS_ARK_API_KEY, base: process.env.BYTEPLUS_ARK_BASE_URL };
  process.env.BYTEPLUS_ARK_API_KEY = KEY;
  delete process.env.BYTEPLUS_ARK_BASE_URL;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seedance-"));
});
afterEach(() => {
  if (saved.key === undefined) delete process.env.BYTEPLUS_ARK_API_KEY; else process.env.BYTEPLUS_ARK_API_KEY = saved.key;
  if (saved.base === undefined) delete process.env.BYTEPLUS_ARK_BASE_URL; else process.env.BYTEPLUS_ARK_BASE_URL = saved.base;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function jsonRes(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, arrayBuffer: async () => new ArrayBuffer(0) };
}
function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected fetch ${url}`);
    return typeof next === "function" ? next(url, init) : next;
  };
  fn.calls = calls;
  return fn;
}

describe("seedance helpers", () => {
  test("clamps clip length to whole seconds between 4 and 12", () => {
    assert.equal(clampSeedanceDuration(0), 4);
    assert.equal(clampSeedanceDuration(3.2), 4);
    assert.equal(clampSeedanceDuration(4.01), 5);
    assert.equal(clampSeedanceDuration(12), 12);
    assert.equal(clampSeedanceDuration(30), 12);
  });
  test("maps the Story frame to a Seedance ratio, portrait by default", () => {
    assert.equal(seedanceRatio("portrait"), "9:16");
    assert.equal(seedanceRatio("landscape"), "16:9");
    assert.equal(seedanceRatio("square"), "1:1");
    assert.equal(seedanceRatio(undefined), "9:16");
  });
  test("adds the no-text line once", () => {
    assert.equal(withNoText("A field at dawn."), `A field at dawn. ${NO_TEXT_LINE}`);
    assert.equal(withNoText(`A field. ${NO_TEXT_LINE}`), `A field. ${NO_TEXT_LINE}`);
  });
  test("is configured only when the key is set", () => {
    assert.equal(isSeedanceConfigured(), true);
    delete process.env.BYTEPLUS_ARK_API_KEY;
    assert.equal(isSeedanceConfigured(), false);
  });
});

describe("submitSeedanceTask", () => {
  test("without a key it refuses and makes no request", async () => {
    delete process.env.BYTEPLUS_ARK_API_KEY;
    const fetchImpl = fakeFetch([]);
    const r = await submitSeedanceTask({ prompt: "x", fetchImpl });
    assert.equal(r.ok, false);
    assert.equal(r.code, "NOT_CONFIGURED");
    assert.equal(fetchImpl.calls.length, 0);
  });

  test("text-to-video sends the documented body", async () => {
    const fetchImpl = fakeFetch([jsonRes(200, { id: "cgt-1" })]);
    const r = await submitSeedanceTask({ prompt: "A lamp in a quiet room.", aspect: "landscape", durationSec: 6.2, fetchImpl });
    assert.deepEqual(r, { ok: true, taskId: "cgt-1", mode: "text" });
    const [call] = fetchImpl.calls;
    assert.equal(call.url, "https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks");
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.headers.Authorization, `Bearer ${KEY}`);
    assert.deepEqual(call.body, {
      model: SEEDANCE_MODELS.mini, ratio: "16:9", resolution: "720p", duration: 7,
      generate_audio: false, watermark: false,
      content: [{ type: "text", text: `A lamp in a quiet room. ${NO_TEXT_LINE}` }],
    });
  });

  test("image-to-video attaches the picture as the first frame", async () => {
    const pic = path.join(tmp, "scene.png");
    fs.writeFileSync(pic, PNG);
    const fetchImpl = fakeFetch([jsonRes(200, { id: "cgt-2" })]);
    const r = await submitSeedanceTask({ prompt: "Slow push-in.", firstFramePath: pic, fetchImpl });
    assert.deepEqual(r, { ok: true, taskId: "cgt-2", mode: "image" });
    const item = fetchImpl.calls[0].body.content[1];
    assert.equal(item.type, "image_url");
    assert.equal(item.role, "first_frame");
    assert.ok(item.image_url.url.startsWith("data:image/png;base64,"));
  });

  test("falls back to text when the picture may show a real person", async () => {
    const pic = path.join(tmp, "face.jpg");
    fs.writeFileSync(pic, PNG);
    const fetchImpl = fakeFetch([
      jsonRes(400, { error: { code: "InputImageSensitiveContentDetected.PrivacyInformation", message: "may contain real person" } }),
      jsonRes(200, { id: "cgt-3" }),
    ]);
    const r = await submitSeedanceTask({ prompt: "A man prays.", firstFramePath: pic, fetchImpl });
    assert.deepEqual(r, { ok: true, taskId: "cgt-3", mode: "text" });
    assert.equal(fetchImpl.calls.length, 2);
    assert.equal(fetchImpl.calls[1].body.content.length, 1);
  });

  test("a refused prompt comes back as REFUSED in plain words", async () => {
    const fetchImpl = fakeFetch([jsonRes(400, { error: { code: "InputTextSensitiveContentDetected", message: "sensitive" } })]);
    const r = await submitSeedanceTask({ prompt: "x", fetchImpl });
    assert.equal(r.ok, false);
    assert.equal(r.code, "REFUSED");
    assert.match(r.error, /declined this scene's prompt/);
  });

  test("other API errors keep their code", async () => {
    const fetchImpl = fakeFetch([jsonRes(400, { error: { code: "InvalidParameter", message: "duration not valid" } })]);
    const r = await submitSeedanceTask({ prompt: "x", fetchImpl });
    assert.equal(r.code, "InvalidParameter");
    assert.equal(r.error, "duration not valid");
  });

  test("the key never appears in an error", async () => {
    const fetchImpl = async () => { throw new Error(`socket closed for Bearer ${KEY}`); };
    const r = await submitSeedanceTask({ prompt: "x", fetchImpl });
    assert.equal(r.ok, false);
    assert.equal(r.error.includes(KEY), false);
    assert.match(r.error, /\[redacted\]/);
  });
});

describe("waitForSeedanceTask", () => {
  const noSleep = async () => {};
  test("polls through queued and running to the finished clip", async () => {
    const fetchImpl = fakeFetch([
      jsonRes(200, { status: "queued" }),
      jsonRes(200, { status: "running" }),
      jsonRes(200, { status: "succeeded", content: { video_url: "https://cdn/x.mp4" }, usage: { completion_tokens: 108900 } }),
    ]);
    const r = await waitForSeedanceTask("cgt-9", { fetchImpl, sleep: noSleep });
    assert.deepEqual(r, { ok: true, videoUrl: "https://cdn/x.mp4", tokens: 108900 });
    assert.equal(fetchImpl.calls[0].url.endsWith("/contents/generations/tasks/cgt-9"), true);
  });
  test("a failed task is reported", async () => {
    const fetchImpl = fakeFetch([jsonRes(200, { status: "failed", error: { code: "X", message: "model busy" } })]);
    const r = await waitForSeedanceTask("t", { fetchImpl, sleep: noSleep });
    assert.equal(r.code, "FAILED");
    assert.equal(r.error, "model busy");
  });
  test("a task BytePlus no longer has is NOT_FOUND", async () => {
    const fetchImpl = fakeFetch([jsonRes(404, { error: { code: "NotFound", message: "no task" } })]);
    const r = await waitForSeedanceTask("t", { fetchImpl, sleep: noSleep });
    assert.equal(r.code, "NOT_FOUND");
  });
  test("gives up after the time limit", async () => {
    let t = 0;
    const fetchImpl = async () => jsonRes(200, { status: "running" });
    const r = await waitForSeedanceTask("t", { fetchImpl, sleep: async (ms) => { t += ms; }, now: () => t, pollMs: 10_000, timeoutMs: 30_000 });
    assert.equal(r.code, "TIMEOUT");
  });
});

describe("downloadSeedanceVideo", () => {
  test("writes the clip to disk", async () => {
    const dest = path.join(tmp, "clip.mp4");
    const fetchImpl = async () => ({ ok: true, status: 200, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer });
    const n = await downloadSeedanceVideo("https://cdn/x.mp4", dest, { fetchImpl });
    assert.equal(n, 3);
    assert.deepEqual([...fs.readFileSync(dest)], [1, 2, 3]);
  });
  test("a failed download throws and leaves nothing behind", async () => {
    const dest = path.join(tmp, "clip.mp4");
    const fetchImpl = async () => ({ ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0) });
    await assert.rejects(downloadSeedanceVideo("https://cdn/x.mp4", dest, { fetchImpl }), /HTTP 403/);
    assert.equal(fs.existsSync(dest), false);
  });
});
