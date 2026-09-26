import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { workOnce, nextDelay } from "./worker.js";

function fakeApi(job, over = {}) {
  const calls = [];
  return {
    calls,
    claim: async () => { calls.push("claim"); return job; },
    download: async (id, file) => { calls.push(`download:${id}`); fs.writeFileSync(file, "song"); },
    progress: async (id, p) => { calls.push(`progress:${p}`); return { cancelled: false }; },
    upload: async (id, file) => { calls.push(`upload:${fs.readFileSync(file, "utf8")}`); },
    fail: async (id, msg) => { calls.push(`fail:${msg}`); },
    ...over,
  };
}
const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), "bf-worker-core-"));

describe("laptop worker", () => {
  test("idle when there is nothing to do", async () => {
    const api = fakeApi(null);
    assert.equal(await workOnce({ api, remove: async () => {}, tmpRoot: tmpRoot() }), "idle");
    assert.deepEqual(api.calls, ["claim"]);
  });

  test("downloads, separates, uploads, and cleans up", async () => {
    const api = fakeApi({ jobId: "j1", quality: "fast", sourceName: "song.m4a" });
    const root = tmpRoot();
    let seen;
    const remove = async ({ input, outPath, quality, onProgress }) => {
      seen = { input: path.basename(input), quality, source: fs.readFileSync(input, "utf8") };
      onProgress(10);
      fs.writeFileSync(outPath, "instrumental");
    };
    assert.equal(await workOnce({ api, remove, tmpRoot: root, progressEveryMs: 0 }), "done");
    assert.deepEqual(seen, { input: "source.m4a", quality: "fast", source: "song" });
    assert.ok(api.calls.includes("progress:10"));
    assert.equal(api.calls.at(-1), "upload:instrumental");
    assert.deepEqual(fs.readdirSync(root), [], "the temp folder is removed");
  });

  test("a separator failure is reported to the server", async () => {
    const api = fakeApi({ jobId: "j1", quality: "best", sourceName: "song.mp3" });
    const remove = async () => { throw new Error("could not read this song file"); };
    assert.equal(await workOnce({ api, remove, tmpRoot: tmpRoot() }), "failed");
    assert.equal(api.calls.at(-1), "fail:could not read this song file");
  });

  test("a cancel from the server stops the separator and uploads nothing", async () => {
    const api = fakeApi({ jobId: "j1", quality: "best", sourceName: "song.mp3" }, {
      progress: async () => ({ cancelled: true }),
    });
    const remove = ({ signal, onProgress }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")));
      onProgress(5);
    });
    assert.equal(await workOnce({ api, remove, tmpRoot: tmpRoot(), progressEveryMs: 0 }), "cancelled");
    assert.ok(!api.calls.some((c) => c.startsWith("upload") || c.startsWith("fail")));
  });

  test("a source name cannot steer where the download is written", async () => {
    const api = fakeApi({ jobId: "j1", quality: "best", sourceName: "../../evil.exe" });
    let input;
    await workOnce({ api, remove: async (o) => { input = o.input; fs.writeFileSync(o.outPath, "x"); }, tmpRoot: tmpRoot() });
    assert.equal(path.basename(input), "source.exe".replace(".exe", ".audio"));
  });

  test("backs off on repeated network failures, up to a minute", () => {
    assert.equal(nextDelay(0), 5_000);
    assert.equal(nextDelay(1), 10_000);
    assert.equal(nextDelay(10), 60_000);
  });

  test("a dropped connection or a 5xx during upload is retried, so the separation is not lost", async () => {
    let tries = 0;
    const api = fakeApi({ jobId: "j1", quality: "best", sourceName: "song.mp3" }, {
      upload: async () => {
        tries += 1;
        if (tries === 1) throw Object.assign(new Error("fetch failed"), { status: undefined });
        if (tries === 2) throw Object.assign(new Error("POST /result → 502"), { status: 502 });
      },
    });
    const outcome = await workOnce({ api, remove: async ({ outPath }) => fs.writeFileSync(outPath, "x"), tmpRoot: tmpRoot(), retryDelays: [0, 0, 0] });
    assert.equal(outcome, "done");
    assert.equal(tries, 3);
  });

  test("a refusal (4xx) is not retried", async () => {
    let tries = 0;
    const api = fakeApi({ jobId: "j1", quality: "best", sourceName: "song.mp3" }, {
      upload: async () => { tries += 1; throw Object.assign(new Error("POST /result → 409"), { status: 409 }); },
    });
    const outcome = await workOnce({ api, remove: async ({ outPath }) => fs.writeFileSync(outPath, "x"), tmpRoot: tmpRoot(), retryDelays: [0, 0, 0] });
    assert.equal(outcome, "failed");
    assert.equal(tries, 1);
  });

  test("after the last retry the failure is reported", async () => {
    let tries = 0;
    const api = fakeApi({ jobId: "j1", quality: "best", sourceName: "song.mp3" }, {
      upload: async () => { tries += 1; throw Object.assign(new Error("POST /result → 502"), { status: 502 }); },
    });
    const outcome = await workOnce({ api, remove: async ({ outPath }) => fs.writeFileSync(outPath, "x"), tmpRoot: tmpRoot(), retryDelays: [0, 0] });
    assert.equal(outcome, "failed");
    assert.equal(tries, 3);
    assert.match(api.calls.at(-1), /^fail:/);
  });
});
