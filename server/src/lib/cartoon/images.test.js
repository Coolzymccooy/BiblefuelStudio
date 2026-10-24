import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { createProject, readProject, projectOutputDir } from "./store.js";
import { makePortrait } from "./images.js";

function setup(cast) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cartoon-images-"));
  const dataDir = path.join(root, "data");
  const outputDir = path.join(root, "out");
  const sharedDir = path.join(root, "shared-genImg");
  fs.mkdirSync(sharedDir, { recursive: true });
  const project = createProject(dataDir, {
    meta: { title: "Pilot", style: "storybook" },
    cast: cast || { Mary: { name: "Mary", look: "a young woman in a blue cloak", voice: "", portrait: null, approved: true, shelfId: null } },
  });
  return { root, ctx: { dataDir, outputDir }, project, sharedDir };
}

/** A stub image chain: writes a fake picture into a shared folder, like generateBibleImage does. */
function imageStub(sharedDir, calls) {
  return async (args) => {
    calls.push(args);
    const file = path.join(sharedDir, `${args.seriesId}-part-${args.partNumber}.png`);
    fs.writeFileSync(file, Buffer.from("png-bytes"));
    return { ok: true, path: file, publicUrl: `/outputs/genImg/${args.seriesId}/part-${args.partNumber}.png`, cached: false };
  };
}

test("a portrait is saved under pictures/ with a fresh name and is not yet approved", async () => {
  const { root, ctx, project, sharedDir } = setup();
  try {
    const calls = [];
    const image = imageStub(sharedDir, calls);
    const first = await makePortrait(ctx, project, "Mary", { image });
    const second = await makePortrait(ctx, project, "Mary", { image });

    const a = first.cast.Mary.portrait;
    const b = second.cast.Mary.portrait;
    assert.equal(a.status, "done");
    assert.equal(a.error, null);
    assert.match(a.file, /^pictures\/mary-\d+\.png$/);
    assert.equal(a.url, `/outputs/cartoons/${project.id}/pictures/${path.basename(a.file)}`);
    assert.notEqual(a.file, b.file);
    assert.equal(first.cast.Mary.approved, false);

    const saved = path.join(projectOutputDir(ctx.outputDir, project.id), "pictures", path.basename(b.file));
    assert.equal(fs.readFileSync(saved, "utf8"), "png-bytes");
    // the shared genImg copy is cleaned up
    assert.deepEqual(fs.readdirSync(sharedDir), []);

    // every attempt gets its own cache key, so the chain never serves an old picture
    assert.equal(calls.length, 2);
    assert.equal(calls[0].aspect, "portrait");
    assert.equal(calls[0].seriesId, `cartoon-${project.id.slice(0, 8)}`);
    assert.notEqual(calls[0].partNumber, calls[1].partNumber);
    assert.match(calls[0].rawPrompt, /Mary/);
    assert.match(calls[0].rawPrompt, /blue cloak/);
    assert.equal(readProject(ctx.dataDir, project.id).cast.Mary.portrait.file, b.file);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an empty look is refused without calling the image chain", async () => {
  const { root, ctx, project } = setup({
    Joseph: { name: "Joseph", look: "  ", voice: "", portrait: null, approved: false, shelfId: null },
  });
  try {
    let called = 0;
    const out = await makePortrait(ctx, project, "Joseph", { image: async () => { called += 1; return { ok: false }; } });
    assert.equal(called, 0);
    assert.equal(out.cast.Joseph.portrait.status, "error");
    assert.equal(out.cast.Joseph.portrait.error, "Describe Joseph's look first.");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a failed picture records the error and keeps the old portrait file", async () => {
  const { root, ctx, project, sharedDir } = setup();
  try {
    const good = await makePortrait(ctx, project, "Mary", { image: imageStub(sharedDir, []) });
    const before = good.cast.Mary.portrait;

    const failed = await makePortrait(ctx, project, "Mary", { image: async () => ({ ok: false, error: "cloudflare: quota" }) });
    const after = failed.cast.Mary.portrait;
    assert.equal(after.status, "error");
    assert.ok(after.error.length > 0);
    assert.equal(after.file, before.file);
    assert.equal(after.url, before.url);
    assert.ok(fs.existsSync(path.join(projectOutputDir(ctx.outputDir, project.id), "pictures", path.basename(before.file))));

    const skipped = await makePortrait(ctx, project, "Mary", { image: async () => ({ ok: false, skipped: true, error: "image gen disabled" }) });
    assert.equal(skipped.cast.Mary.portrait.error, "Picture making is not set up on this server.");

    const thrown = await makePortrait(ctx, project, "Mary", { image: async () => { throw new Error("boom"); } });
    assert.equal(thrown.cast.Mary.portrait.status, "error");
    assert.equal(thrown.cast.Mary.portrait.file, before.file);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the page can see the portrait is being made while the picture is drawn", async () => {
  const { root, ctx, project, sharedDir } = setup();
  try {
    let during = null;
    const image = async (args) => {
      during = readProject(ctx.dataDir, project.id).cast.Mary.portrait;
      return imageStub(sharedDir, [])(args);
    };
    await makePortrait(ctx, project, "Mary", { image });
    assert.equal(during.status, "making");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a name that is not an own cast member (such as a prototype key) is refused", async () => {
  const { root, ctx, project } = setup();
  try {
    let called = 0;
    const image = async () => { called += 1; return { ok: false }; };
    for (const name of ["toString", "__proto__", "constructor", "Nobody"]) {
      await assert.rejects(() => makePortrait(ctx, project, name, { image }), /No character called/);
    }
    assert.equal(called, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
