import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { createProject, readProject, projectOutputDir } from "./store.js";
import { listShelf, shelve, fromShelf, removeFromShelf } from "./shelf.js";

const MARY = { name: "Mary", look: "a young woman in a blue cloak", voice: "warm and soft", approved: true, shelfId: null };

/** A temp user folder with a cartoon whose Mary has an approved portrait on disk. */
function setup({ style = "storybook", approved = true, cast } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cartoon-shelf-"));
  const ctx = { dataDir: path.join(root, "data"), outputDir: path.join(root, "out") };
  const project = makeProject(ctx, style, cast || { Mary: { ...MARY, approved, portrait: null } }, "Mary");
  return { root, ctx, project };
}

/** Creates a project and writes a picture for `withPicture` under its pictures/ folder. */
function makeProject(ctx, style, cast, withPicture) {
  const project = createProject(ctx.dataDir, { meta: { title: "Pilot", style }, cast, pictureCount: 0 });
  if (!withPicture) return project;
  const dir = path.join(projectOutputDir(ctx.outputDir, project.id), "pictures");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "mary-1.png"), "mary-face");
  const portrait = { file: "pictures/mary-1.png", url: `/outputs/cartoons/${project.id}/pictures/mary-1.png`, status: "done", error: null };
  const member = { ...project.cast[withPicture], portrait };
  const next = { ...project, cast: { ...project.cast, [withPicture]: member } };
  fs.writeFileSync(path.join(ctx.dataDir, "cartoons", `${project.id}.json`), JSON.stringify(next));
  return next;
}

test("a shelved character comes back approved in a new cartoon with the same portrait", () => {
  const { root, ctx, project } = setup();
  try {
    const saved = shelve(ctx, project, "Mary");
    assert.match(saved.id, /^[0-9a-f-]{36}$/);
    assert.equal(saved.name, "Mary");
    assert.equal(saved.look, MARY.look);
    assert.equal(saved.voice, MARY.voice);
    assert.equal(saved.style, "storybook");
    assert.equal(saved.portraitUrl, `/outputs/cartoon-cast/${saved.id}.png`);
    assert.equal(typeof saved.createdAt, "number");
    assert.equal(fs.readFileSync(path.join(ctx.outputDir, "cartoon-cast", `${saved.id}.png`), "utf8"), "mary-face");
    assert.deepEqual(listShelf(ctx), [saved]);

    const fresh = createProject(ctx.dataDir, { meta: { title: "Next", style: "storybook" }, cast: {}, pictureCount: 0 });
    const out = fromShelf(ctx, fresh, saved.id);
    const mary = out.cast.Mary;
    assert.equal(mary.approved, true);
    assert.equal(mary.shelfId, saved.id);
    assert.equal(mary.look, MARY.look);
    assert.equal(mary.voice, MARY.voice);
    assert.equal(mary.styleMismatch, false);
    assert.equal(mary.portrait.status, "done");
    assert.match(mary.portrait.file, /^pictures\/shelf-[0-9a-f]{8}-\d+\.png$/);
    assert.equal(mary.portrait.url, `/outputs/cartoons/${fresh.id}/pictures/${path.basename(mary.portrait.file)}`);

    // the picture is inside the new project's own folder, where the film stage looks
    const copied = path.join(projectOutputDir(ctx.outputDir, fresh.id), mary.portrait.file);
    assert.equal(fs.readFileSync(copied, "utf8"), "mary-face");
    assert.deepEqual(readProject(ctx.dataDir, fresh.id).cast.Mary, mary);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("only an approved portrait can be shelved", () => {
  const { root, ctx, project } = setup({ approved: false });
  try {
    assert.throws(() => shelve(ctx, project, "Mary"), /Approve Mary's portrait first/);
    assert.throws(() => shelve(ctx, project, "Nobody"), /No character called Nobody/);
    assert.throws(() => shelve(ctx, project, "__proto__"), /No character called/);
    assert.deepEqual(listShelf(ctx), []);

    // approved, but no picture was ever made
    const bare = makeProject(ctx, "storybook", { Eli: { name: "Eli", look: "a boy", voice: "", portrait: null, approved: true, shelfId: null } });
    assert.throws(() => shelve(ctx, bare, "Eli"), /Approve Eli's portrait first/);
    assert.deepEqual(listShelf(ctx), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a portrait path that escapes the project folder is refused", () => {
  const { root, ctx, project } = setup();
  try {
    fs.writeFileSync(path.join(root, "secret.png"), "secret");
    const evil = { ...project, cast: { Mary: { ...project.cast.Mary, portrait: { ...project.cast.Mary.portrait, file: "../../../secret.png" } } } };
    fs.writeFileSync(path.join(ctx.dataDir, "cartoons", `${project.id}.json`), JSON.stringify(evil));
    assert.throws(() => shelve(ctx, evil, "Mary"), /Approve Mary's portrait first/);
    assert.deepEqual(listShelf(ctx), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a character from another style is allowed but marked", () => {
  const { root, ctx, project } = setup({ style: "storybook" });
  try {
    const saved = shelve(ctx, project, "Mary");
    const other = createProject(ctx.dataDir, { meta: { title: "Other", style: "clay" }, cast: {}, pictureCount: 0 });
    const out = fromShelf(ctx, other, saved.id);
    assert.equal(out.cast.Mary.styleMismatch, true);
    assert.equal(out.cast.Mary.approved, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("fromShelf as another name, or onto an existing cast member, overwrites in place", () => {
  const { root, ctx, project } = setup();
  try {
    const saved = shelve(ctx, project, "Mary");
    const target = createProject(ctx.dataDir, {
      meta: { title: "Next", style: "storybook" },
      cast: { Miriam: { name: "Miriam", look: "old look", voice: "old", portrait: null, approved: false, shelfId: null }, Eli: { name: "Eli", look: "a boy", voice: "", portrait: null, approved: false, shelfId: null } },
      pictureCount: 0,
    });
    const out = fromShelf(ctx, target, saved.id, "Miriam");
    assert.equal(out.cast.Miriam.look, MARY.look);
    assert.equal(out.cast.Miriam.name, "Miriam");
    assert.equal(out.cast.Miriam.approved, true);
    assert.equal(out.cast.Miriam.shelfId, saved.id);
    assert.equal(out.cast.Eli.look, "a boy");
    assert.equal(Object.keys(out.cast).length, 2);

    // a second pull gets its own file name
    const again = fromShelf(ctx, out, saved.id, "Rhoda");
    assert.notEqual(again.cast.Rhoda.portrait.file, again.cast.Miriam.portrait.file);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("fromShelf refuses unplain names and unknown characters", () => {
  const { root, ctx, project } = setup();
  try {
    const saved = shelve(ctx, project, "Mary");
    const target = createProject(ctx.dataDir, { meta: { title: "Next", style: "storybook" }, cast: {}, pictureCount: 0 });
    for (const bad of ["__proto__", "constructor", "prototype", "", "   "]) {
      assert.throws(() => fromShelf(ctx, target, saved.id, bad), /name/i, `rejects ${JSON.stringify(bad)}`);
    }
    assert.throws(() => fromShelf(ctx, target, "no-such-id"), /^Error: No character on the shelf/);
    assert.deepEqual(readProject(ctx.dataDir, target.id).cast, {});
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("removing a character deletes its record and picture but not copies already in cartoons", () => {
  const { root, ctx, project } = setup();
  try {
    const saved = shelve(ctx, project, "Mary");
    const target = createProject(ctx.dataDir, { meta: { title: "Next", style: "storybook" }, cast: {}, pictureCount: 0 });
    const out = fromShelf(ctx, target, saved.id);

    assert.equal(removeFromShelf(ctx, saved.id), true);
    assert.deepEqual(listShelf(ctx), []);
    assert.equal(fs.existsSync(path.join(ctx.outputDir, "cartoon-cast", `${saved.id}.png`)), false);
    assert.equal(fs.existsSync(path.join(projectOutputDir(ctx.outputDir, target.id), out.cast.Mary.portrait.file)), true);
    assert.equal(removeFromShelf(ctx, saved.id), false);
    assert.throws(() => fromShelf(ctx, target, saved.id), /No character on the shelf/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("each user's shelf is separate, and a damaged shelf file reads as empty", () => {
  const { root, ctx, project } = setup();
  try {
    shelve(ctx, project, "Mary");
    const other = { dataDir: path.join(root, "other-data"), outputDir: path.join(root, "other-out") };
    assert.deepEqual(listShelf(other), []);
    fs.writeFileSync(path.join(ctx.dataDir, "cartoon-cast.json"), "{not json");
    assert.deepEqual(listShelf(ctx), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
