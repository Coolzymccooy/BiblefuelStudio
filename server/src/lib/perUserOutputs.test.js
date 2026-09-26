import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { createPerUserOutputFinder, outputSegments } from "./perUserOutputs.js";

const BACKSLASH = String.fromCharCode(92);
const PROJECT = "3f2c9a1e-5b7d-4c8e-9f01-23456789abcd";
let dataDir;
let find;

function put(uid, rel, body = "x") {
  const file = path.join(dataDir, "users", uid, "outputs", ...rel.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
}

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "peruser-"));
  find = createPerUserOutputFinder(dataDir);
});
afterEach(() => fs.rmSync(dataDir, { recursive: true, force: true }));

describe("per-user outputs", () => {
  it("still serves a flat render", () => {
    const file = put("u1", "abc.mp4");
    assert.equal(find("abc.mp4"), fs.realpathSync(file));
  });

  it("serves an ambient session's video from its project folder", () => {
    const file = put("u1", `ambient/${PROJECT}/video.mp4`);
    assert.equal(find(`ambient/${PROJECT}/video.mp4`), fs.realpathSync(file));
  });

  it("finds it whichever account holds it", () => {
    put("u1", "other.mp4");
    const file = put("u2", `story/${PROJECT}/final.mp4`);
    assert.equal(find(`/story/${PROJECT}/final.mp4`), fs.realpathSync(file));
  });

  it("does not serve a nested path without an unguessable id in it", () => {
    put("u1", "genImg/series-1/part-1.png");
    assert.equal(find("genImg/series-1/part-1.png"), null);
  });

  it("refuses traversal and odd paths", () => {
    put("u1", `ambient/${PROJECT}/video.mp4`);
    fs.writeFileSync(path.join(dataDir, "secret.json"), "{}");
    for (const bad of [
      `ambient/${PROJECT}/../../../../secret.json`,
      `ambient/${PROJECT}/./video.mp4`,
      `ambient/${PROJECT}//video.mp4`,
      ["ambient", PROJECT, "video.mp4"].join(BACKSLASH),
      `C:/${PROJECT}/x`,
      `a/b/c/${PROJECT}/video.mp4`,
      "",
    ]) {
      assert.equal(find(bad), null, bad);
    }
  });

  it("a backslash is never a way round the id check", () => {
    // Windows treats it as a separator: "genImg\series-1\part-1.png" read as
    // one flat name skipped the id check and served a predictable path.
    put("u1", "genImg/series-1/part-1.png");
    const B = BACKSLASH;
    for (const bad of [
      `/genImg${B}series-1${B}part-1.png`,
      `/aaaaaaaaaaaaaaaaaaaaaa/..${B}genImg/series-1/part-1.png`,
    ]) {
      assert.equal(outputSegments(bad), null, bad);
      assert.equal(find(bad), null, bad);
    }
  });

  it("the id must be a whole folder name, not a long file name", () => {
    put("u1", "genImg/a_very_long_file_name_chosen.png");
    assert.equal(find("genImg/a_very_long_file_name_chosen.png"), null);
    put("u1", "my notes.3f2c9a1e-5b7d-4c8e-9f01-23456789abcd/v.mp4");
    assert.equal(find("my notes.3f2c9a1e-5b7d-4c8e-9f01-23456789abcd/v.mp4"), null, "part of a name is not the id");
  });

  it("does not serve a folder", () => {
    put("u1", `ambient/${PROJECT}/video.mp4`);
    assert.equal(find(`ambient/${PROJECT}`), null);
  });

  it("does not follow a link out of the account's outputs", (t) => {
    const outside = path.join(dataDir, "outside");
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, "video.mp4"), "x");
    fs.mkdirSync(path.join(dataDir, "users", "u1", "outputs", "ambient"), { recursive: true });
    try {
      fs.symlinkSync(outside, path.join(dataDir, "users", "u1", "outputs", "ambient", PROJECT), "junction");
    } catch {
      t.skip("cannot create links here");
      return;
    }
    assert.equal(find(`ambient/${PROJECT}/video.mp4`), null);
  });

  it("parses segments", () => {
    assert.deepEqual(outputSegments("a.mp4"), ["a.mp4"]);
    assert.deepEqual(outputSegments(`/ambient/${PROJECT}/video.mp4`), ["ambient", PROJECT, "video.mp4"]);
    assert.equal(outputSegments("a\0.mp4"), null);
  });
});
