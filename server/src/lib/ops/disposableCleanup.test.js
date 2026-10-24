import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanupDisposableFiles, allOutputDirs } from "./disposableCleanup.js";
import { diskStatus } from "./disk.js";

const DAY = 86_400_000;
const NOW = Date.now();

function put(file, ageDays) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "x".repeat(10));
  const t = new Date(NOW - ageDays * DAY);
  fs.utimesSync(file, t, t);
  return file;
}

test("only old throwaway files go; finished work and anything recent stay", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-"));
  const old = 30;
  const gone = [
    put(path.join(root, "captioned-args-captioned-abc.txt"), old),
    put(path.join(root, "captioned-stderr-captioned-abc.txt"), old),
    put(path.join(root, "concat-1234-abcd.txt"), old),
    put(path.join(root, "waveform-1234-abcd.png"), old),
    put(path.join(root, "cache", "remote-bg", "a", "clip.mp4"), old),
  ];
  const kept = [
    put(path.join(root, "waveform-1234-abcd.mp4"), old), // a waveform video is a user's finished file
    put(path.join(root, "captioned-abc.mp4"), old),
    put(path.join(root, "user-audio-1.mp3"), old),
    put(path.join(root, "visual-library", "v1", "clip.mp4"), old),
    put(path.join(root, "story", "p1", "video.mp4"), old),
    put(path.join(root, "story", "p1", "concat-1234.txt"), old), // only the top level is swept
    put(path.join(root, "concat-new.txt"), 1), // too recent
    put(path.join(root, "cache", "remote-bg", "fresh.mp4"), 1),
  ];

  const r = cleanupDisposableFiles([root], { now: NOW, env: {} });
  assert.equal(r.removed, gone.length);
  assert.equal(r.bytes, gone.length * 10);
  for (const f of gone) assert.equal(fs.existsSync(f), false, `${path.basename(f)} is removed`);
  for (const f of kept) assert.equal(fs.existsSync(f), true, `${path.basename(f)} is kept`);
});

test("the age limit comes from MEDIA_CLEANUP_MAX_AGE_DAYS, never under a day", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-"));
  const f = put(path.join(root, "concat-a.txt"), 3);
  assert.equal(cleanupDisposableFiles([root], { now: NOW, env: { MEDIA_CLEANUP_MAX_AGE_DAYS: "0" } }).removed, 0, "0 falls back to 14");
  assert.equal(cleanupDisposableFiles([root], { now: NOW, env: { MEDIA_CLEANUP_MAX_AGE_DAYS: "2" } }).removed, 1);
  assert.equal(fs.existsSync(f), false);
});

test("allOutputDirs lists the owner's folder and each user's, and a missing folder is fine", () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-data-"));
  fs.mkdirSync(path.join(data, "users", "u1"), { recursive: true });
  fs.writeFileSync(path.join(data, "users", "stray.json"), "{}");
  assert.deepEqual(allOutputDirs(data, "/out"), ["/out", path.join(data, "users", "u1", "outputs")]);
  assert.deepEqual(cleanupDisposableFiles([path.join(data, "missing")], { now: NOW, env: {} }), { removed: 0, bytes: 0 });
});

test("diskStatus flags low space by the larger of the two floors", () => {
  const GB = 1024 ** 3;
  const fake = (freeGb, totalGb) => () => ({ bsize: 1024, blocks: (totalGb * GB) / 1024, bavail: (freeGb * GB) / 1024 });
  assert.deepEqual(diskStatus("/", { env: {}, statfs: fake(8, 16) }), { freeGb: 8, totalGb: 16, freePercent: 50, low: false });
  assert.equal(diskStatus("/", { env: {}, statfs: fake(1.5, 16) }).low, true, "under 2 GB");
  assert.equal(diskStatus("/", { env: {}, statfs: fake(9, 100) }).low, true, "under 10 % of a big disk");
  assert.equal(diskStatus("/", { env: { DISK_ALARM_MIN_FREE_GB: "1", DISK_ALARM_MIN_FREE_PERCENT: "5" }, statfs: fake(6, 100) }).low, false);
  assert.equal(diskStatus("/", { statfs: () => { throw new Error("ENOSYS"); } }), null);
  assert.ok(diskStatus(os.tmpdir()), "works on this machine");
});
