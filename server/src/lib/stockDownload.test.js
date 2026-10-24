/**
 * Pexels and Pixabay clips are saved under one global name per id
 * (pexels-<id>.mp4, pixabay-<id>.mp4) that every account shares (#112). A
 * second download of the same id must never truncate the file while another
 * render reads it: an existing non-empty file is reused without any request,
 * and a new download is written to a unique .part file and renamed into place.
 */
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "stock-dl-"));
process.env.OUTPUT_DIR = path.join(root, "outputs");
process.env.DATA_DIR = path.join(root, "data");
fs.mkdirSync(process.env.OUTPUT_DIR, { recursive: true });

const pexels = await import("./pexels.js");
const pixabay = await import("./pixabay.js");
const OUT = process.env.OUTPUT_DIR;

const providers = [
  {
    name: "pexels", mod: pexels, download: pexels.pexelsDownloadVideoById, keyEnv: "PEXELS_API_KEY",
    api: { video_files: [{ width: 720, link: "https://cdn.example/p.mp4" }] },
  },
  {
    name: "pixabay", mod: pixabay, download: pixabay.pixabayDownloadVideoById, keyEnv: "PIXABAY_API_KEY",
    api: { hits: [{ videos: { medium: { url: "https://cdn.example/x.mp4" } } }] },
  },
];

let calls;
function stubFetch(mod, api, body) {
  mod._setFetchForTest(async (url) => {
    calls.push(String(url));
    if (String(url).startsWith("https://cdn.example/")) return { ok: true, status: 200, body: body() };
    return { ok: true, status: 200, json: async () => api, text: async () => "" };
  });
}

before(() => { for (const p of providers) process.env[p.keyEnv] = "test-key-not-real"; });
after(() => {
  for (const p of providers) { p.mod._resetFetchForTest(); delete process.env[p.keyEnv]; }
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
});
beforeEach(() => { calls = []; });

const leftovers = () => fs.readdirSync(OUT).filter((n) => n.endsWith(".part"));

for (const p of providers) {
  describe(`${p.name} download`, () => {
    test("an existing non-empty clip is reused with no request and left as it is", async () => {
      const file = path.join(OUT, `${p.name}-111.mp4`);
      fs.writeFileSync(file, "already here");
      stubFetch(p.mod, p.api, () => Readable.from([Buffer.from("new")]));
      assert.equal(path.resolve(await p.download("111")), path.resolve(file));
      assert.deepEqual(calls, []);
      assert.equal(fs.readFileSync(file, "utf8"), "already here");
    });

    test("a new clip is written to a .part file and only then renamed into place", async () => {
      const file = path.join(OUT, `${p.name}-222.mp4`);
      let seenDuring = null;
      async function* chunks() {
        yield Buffer.from("first ");
        seenDuring = fs.existsSync(file);
        yield Buffer.from("second");
      }
      stubFetch(p.mod, p.api, () => Readable.from(chunks()));
      assert.equal(path.resolve(await p.download("222")), path.resolve(file));
      assert.equal(seenDuring, false, "the final name never holds a partial file");
      assert.equal(fs.readFileSync(file, "utf8"), "first second");
      assert.deepEqual(leftovers(), []);
    });

    test("an empty leftover is replaced, and a failed download leaves nothing behind", async () => {
      const file = path.join(OUT, `${p.name}-333.mp4`);
      fs.writeFileSync(file, "");
      stubFetch(p.mod, p.api, () => Readable.from([Buffer.from("good")]));
      await p.download("333");
      assert.equal(fs.readFileSync(file, "utf8"), "good");

      const broken = path.join(OUT, `${p.name}-444.mp4`);
      async function* failing() { yield Buffer.from("half"); throw new Error("connection reset"); }
      stubFetch(p.mod, p.api, () => Readable.from(failing()));
      await assert.rejects(p.download("444"), /connection reset/);
      assert.equal(fs.existsSync(broken), false);
      assert.deepEqual(leftovers(), []);
    });
  });
}
