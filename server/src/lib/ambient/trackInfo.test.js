import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { trackInfo, BUNDLED_CREDIT } from "./trackInfo.js";
import { registerTrack } from "../musicLibraryStore.js";
import { listTracks } from "../musicLibrary.js";

describe("trackInfo", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-trackinfo-"));

  test("a bundled track reads its label and the Pixabay credit", () => {
    const first = listTracks()[0];
    assert.deepEqual(trackInfo(dataDir, `library:${first.id}`), { label: first.label, credit: BUNDLED_CREDIT });
  });

  test("an upload reads its own label and credit", () => {
    const file = path.join(dataDir, "song.mp3");
    fs.writeFileSync(file, "x");
    const t = registerTrack(dataDir, { file, label: "Morning", credit: "Music by Ada · Pixabay" });
    assert.deepEqual(trackInfo(dataDir, `mylib:${t.id}`), { label: "Morning", credit: "Music by Ada · Pixabay" });
  });

  test("an unknown ref falls back to its own text and no credit", () => {
    assert.deepEqual(trackInfo(dataDir, "mylib:nope"), { label: "mylib:nope", credit: "" });
  });

  test("a bare path reads as its file name", () => {
    assert.deepEqual(trackInfo(dataDir, "C:\\out\\bed-1.m4a"), { label: "bed-1.m4a", credit: "" });
  });
});
