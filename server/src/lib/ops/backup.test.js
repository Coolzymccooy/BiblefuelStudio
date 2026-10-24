import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  dataBackupFiles, runDataBackup, runOutputsBackup, restoreDataBackup, restoreOutputs,
  outputRoots, folderTarget, DATA_PREFIX,
} from "./backup.js";

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
function put(root, rel, body = rel) {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
  return f;
}

function fakeDataDir() {
  const data = tmp("bk-data-");
  put(data, "users.json", JSON.stringify({ users: [{ id: "u1" }] }));
  put(data, "plan.json", "{}");
  put(data, "videogen-spend.json", "{\"settledUsd\":3}");
  put(data, "users/u1/story-projects/p1.json", "{\"title\":\"Grace\"}");
  put(data, "users/u1/render-jobs/j1.json", "{}");
  put(data, "users/u1/outputs/story/p1/video.mp4", "VIDEO");
  put(data, "bibleCache/kjv/john.json", "{}");
  put(data, "ambient/a1/song.mp3", "AUDIO");
  put(data, "visual-library.json.123.tmp", "half");
  return data;
}

test("a data backup holds the records and leaves out media, caches and temp files", () => {
  const files = dataBackupFiles(fakeDataDir());
  assert.deepEqual(files, [
    "plan.json",
    "users.json",
    "users/u1/render-jobs/j1.json",
    "users/u1/story-projects/p1.json",
    "videogen-spend.json",
  ]);
});

test("restore drill: back up, restore into an empty folder, every record comes back the same", async () => {
  const data = fakeDataDir();
  const store = tmp("bk-store-");
  const target = folderTarget(store);
  const now = Date.parse("2026-10-24T03:00:00Z");
  const r = await runDataBackup({ dataDir: data, target, now, env: {}, tmpDir: tmp("bk-tmp-") });
  assert.equal(r.key, `${DATA_PREFIX}2026-10-24.tar.gz`);
  assert.equal(r.files, 5);
  assert.ok(r.bytes > 0);

  const restored = path.join(tmp("bk-restore-"), "data");
  const back = await restoreDataBackup({ target, toDir: restored });
  assert.equal(back.key, r.key, "the newest backup by default");
  assert.equal(back.files, 5);
  for (const rel of dataBackupFiles(data)) {
    assert.equal(fs.readFileSync(path.join(restored, rel), "utf8"), fs.readFileSync(path.join(data, rel), "utf8"), rel);
  }

  await assert.rejects(restoreDataBackup({ target, toDir: restored }), /not empty/, "never restores over live data");
  await assert.rejects(restoreDataBackup({ target, toDir: path.join(tmp("bk-x-"), "d"), date: "2026-01-01" }), /No data backup for 2026-01-01/);
});

test("only the last BACKUP_KEEP_DAYS data backups are kept", async () => {
  const data = fakeDataDir();
  const target = folderTarget(tmp("bk-store-"));
  const day = 86_400_000;
  const start = Date.parse("2026-10-01T03:00:00Z");
  for (let i = 0; i < 5; i += 1) await runDataBackup({ dataDir: data, target, now: start + i * day, env: { BACKUP_KEEP_DAYS: "3" } });
  assert.deepEqual(await target.list(DATA_PREFIX), [
    `${DATA_PREFIX}2026-10-03.tar.gz`, `${DATA_PREFIX}2026-10-04.tar.gz`, `${DATA_PREFIX}2026-10-05.tar.gz`,
  ]);
});

test("outputs are copied once, changes are copied again, throwaway files never, and a night has a size limit", async () => {
  const data = tmp("bk-data-");
  const owner = tmp("bk-out-");
  put(owner, "captioned-abc.mp4", "A".repeat(100));
  put(owner, "story/p1/video.mp4", "B".repeat(100));
  put(owner, "visual-library/v1/clip.mp4", "C".repeat(100));
  put(owner, "captioned-args-captioned-abc.txt", "dump");
  put(owner, "cache/remote-bg/x.mp4", "cache");
  put(owner, "stems-work/j1/a.wav", "work");
  put(data, "users/u1/outputs/moment.mp4", "D".repeat(100));
  const roots = outputRoots(data, owner);
  assert.deepEqual(roots.map((r) => r.label), ["owner", "users/u1"]);

  const target = folderTarget(tmp("bk-store-"));
  const manifestFile = path.join(data, "backup-manifest.json");
  // 250 bytes a night: two files fit, the rest wait for the next night.
  const env = { BACKUP_OUTPUTS_MAX_GB: String(250 / 1024 ** 3) };
  const first = await runOutputsBackup({ roots, target, manifestFile, env });
  assert.deepEqual({ copied: first.copied, pending: first.pending }, { copied: 2, pending: 2 });
  const second = await runOutputsBackup({ roots, target, manifestFile, env });
  assert.equal(second.copied, 2);
  assert.equal((await runOutputsBackup({ roots, target, manifestFile, env })).copied, 0, "nothing new");

  const keys = await target.list("backups/outputs/");
  assert.deepEqual(keys, [
    "backups/outputs/owner/captioned-abc.mp4",
    "backups/outputs/owner/story/p1/video.mp4",
    "backups/outputs/owner/visual-library/v1/clip.mp4",
    "backups/outputs/users/u1/moment.mp4",
  ]);

  const later = new Date(Date.now() + 5000);
  fs.writeFileSync(path.join(owner, "story/p1/video.mp4"), "E".repeat(120));
  fs.utimesSync(path.join(owner, "story/p1/video.mp4"), later, later);
  assert.equal((await runOutputsBackup({ roots, target, manifestFile, env: {} })).copied, 1, "a changed file is copied again");

  const restored = tmp("bk-restore-out-");
  assert.equal((await restoreOutputs({ target, toDir: restored })).files, 4);
  assert.equal(fs.readFileSync(path.join(restored, "owner/story/p1/video.mp4"), "utf8"), "E".repeat(120));
  assert.equal(fs.readFileSync(path.join(restored, "users/u1/moment.mp4"), "utf8"), "D".repeat(100));
});

test("a folder target refuses keys that climb out of it", async () => {
  const target = folderTarget(tmp("bk-store-"));
  await assert.rejects(target.put(__filename_safe(), "../escape.txt"), /Bad backup key/);
});

function __filename_safe() {
  const f = path.join(tmp("bk-src-"), "f.txt");
  fs.writeFileSync(f, "x");
  return f;
}
