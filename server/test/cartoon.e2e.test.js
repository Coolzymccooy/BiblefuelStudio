import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import express from "express";
import request from "supertest";

/**
 * Cartoon mode end to end (plan task 18): an example script becomes a
 * rendered film through the real HTTP routes, the real film and render
 * stages, the real spend ledger, the real visual library and real ffmpeg.
 *
 * Only the paid or networked edges are stubbed, at the router's `deps` seam:
 * the portrait image chain, the verse lookup, Seedance submit/wait/download,
 * the speech transcription (answers with the line, so the check matches) and
 * Remotion (serveUrl plus a render that writes a real small mp4). Clips are
 * real lavfi videos (tone plus colour), so poster, last frame, speech windows,
 * probe, bed staging and the loudness pass all run for real. A fetch tripwire
 * proves nothing reached the network.
 *
 * DATA_DIR and OUTPUT_DIR point at a temp folder before any server module is
 * imported (paths.js reads them at import), and the folder is removed after.
 */

const FF = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const hasFfmpeg = spawnSync(FF, ["-version"]).status === 0;
const COLOURS = ["0x2f6f4f", "0x7a4a2a", "0x2a4a7a", "0x6a2a6a"];
const TOKENS_PER_CLIP = 100000;

function ffmpegOrThrow(args) {
  const r = spawnSync(FF, ["-nostdin", "-y", "-v", "error", ...args]);
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${String(r.stderr || "").slice(-300)}`);
}

/** A small 9:16 talking-clip stand-in: a flat colour with a steady tone, `seconds` long. */
function makeStubClip(file, seconds, colour) {
  ffmpegOrThrow([
    "-f", "lavfi", "-i", `color=c=${colour}:s=144x256:r=24:d=${seconds}`,
    "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${seconds}`,
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "64k", "-shortest", file,
  ]);
}

function makeStubPortrait(file) {
  ffmpegOrThrow(["-f", "lavfi", "-i", "color=c=0xd8b48a:s=256x384", "-frames:v", "1", file]);
}

async function until(done, { timeoutMs = 120_000, label = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (!done()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("cartoon end to end", { skip: !hasFfmpeg && "ffmpeg not installed" }, () => {
  let root;
  let dataDir;
  let outputDir;
  let app;
  let mod;
  const saved = {};
  const fetchCalls = [];
  const submits = [];
  const renders = [];
  const transcribed = [];
  /** taskId -> { seconds, line }, so the download and the speech check answer for the right shot. */
  const tasks = new Map();
  /** downloaded tmp file -> the line its shot speaks. */
  const linesByFile = new Map();
  const clipBySeconds = new Map();
  let portraitSource;
  let shotLines = [];

  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cartoon-e2e-"));
    dataDir = path.join(root, "data");
    outputDir = path.join(root, "out");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });
    for (const k of ["DATA_DIR", "OUTPUT_DIR", "BYTEPLUS_ARK_API_KEY", "VIDEO_GEN_MONTHLY_CAP_USD", "REMOTION_SERVE_URL"]) saved[k] = process.env[k];
    process.env.DATA_DIR = dataDir;
    process.env.OUTPUT_DIR = outputDir;
    process.env.BYTEPLUS_ARK_API_KEY = "test-key-never-sent";
    process.env.VIDEO_GEN_MONTHLY_CAP_USD = "100";
    delete process.env.REMOTION_SERVE_URL;

    saved.fetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      fetchCalls.push(String(url));
      throw new Error(`Network is off in the cartoon e2e test: ${url}`);
    };

    const fixtures = path.join(root, "fixtures");
    fs.mkdirSync(fixtures, { recursive: true });
    [4, 5, 6].forEach((seconds, i) => {
      const file = path.join(fixtures, `clip-${seconds}s.mp4`);
      makeStubClip(file, seconds, COLOURS[i]);
      clipBySeconds.set(seconds, file);
    });
    portraitSource = path.join(fixtures, "portrait.png");
    makeStubPortrait(portraitSource);

    mod = {
      router: await import("../src/routes/cartoon.js"),
      superAdmin: await import("../src/middleware/requireSuperAdmin.js"),
      store: await import("../src/lib/cartoon/store.js"),
      film: await import("../src/lib/cartoon/filmStage.js"),
      render: await import("../src/lib/cartoon/renderStage.js"),
      spend: await import("../src/lib/videoGen/spend.js"),
      library: await import("../src/lib/visualLibrary/store.js"),
    };

    let taskCount = 0;
    let pictureCount = 0;
    const deps = {
      image: async ({ partNumber }) => {
        pictureCount += 1;
        const file = path.join(root, `chain-portrait-${partNumber}-${pictureCount}.png`);
        fs.copyFileSync(portraitSource, file);
        return { ok: true, path: file };
      },
      lookup: async (ref) => ({ ok: true, canonical: ref, verses: [{ text: "Doth he not leave the ninety and nine, and go after that which is lost?" }] }),
      llm: async () => { throw new Error("The writer is not used in this test."); },
      film: {
        submit: async (args) => {
          taskCount += 1;
          const taskId = `stub-task-${taskCount}`;
          const firstFrameExists = Boolean(args.firstFramePath) && fs.existsSync(args.firstFramePath);
          const referencesExist = (args.referenceImagePaths || []).every((p) => fs.existsSync(p));
          submits.push({ ...args, taskId, firstFrameExists, referencesExist });
          const line = shotLines.find((l) => args.prompt.includes(l)) || "";
          tasks.set(taskId, { seconds: args.durationSec, line });
          return { ok: true, taskId };
        },
        wait: async (taskId) => ({ ok: true, videoUrl: `https://stub.invalid/${taskId}.mp4`, tokens: TOKENS_PER_CLIP }),
        download: async (url, file) => {
          const taskId = path.basename(new URL(url).pathname, ".mp4");
          const task = tasks.get(taskId);
          if (!task) throw new Error(`Unknown stub task ${taskId}`);
          const source = clipBySeconds.get(task.seconds) || clipBySeconds.get(6);
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.copyFileSync(source, file);
          linesByFile.set(file, task.line);
        },
        transcribe: async (file) => {
          transcribed.push(file);
          return { ok: true, text: linesByFile.get(file) ?? "" };
        },
      },
      render: {
        serveUrl: async () => "http://bundle.invalid",
        render: async (args) => {
          renders.push(args);
          makeStubClip(args.outputLocation, 8, COLOURS[3]);
        },
      },
    };

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.ctx = { dataDir, outputDir, isSuperAdmin: true };
      next();
    });
    app.use("/api/cartoon", mod.superAdmin.requireSuperAdmin, mod.router.createCartoonRouter({ ledgerDir: dataDir, deps }));
  });

  after(() => {
    globalThis.fetch = saved.fetch;
    for (const k of ["DATA_DIR", "OUTPUT_DIR", "BYTEPLUS_ARK_API_KEY", "VIDEO_GEN_MONTHLY_CAP_USD", "REMOTION_SERVE_URL"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    if (root) fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  test("an example becomes a rendered cartoon with stubbed providers", { timeout: 300_000 }, async () => {
    // Create from the lost-lamb example.
    const created = await request(app).post("/api/cartoon").send({ exampleId: "lost-lamb" });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.project.id;
    const shots = created.body.project.shots;
    const names = Object.keys(created.body.project.cast);
    assert.ok(shots.length >= 2, "the example has shots to film");
    assert.ok(names.length >= 2, "the example has a cast");
    shotLines = shots.map((s) => s.line).filter(Boolean);

    // Stub the portraits, then approve them.
    const portraits = await request(app).post(`/api/cartoon/${id}/portraits`).send({});
    assert.equal(portraits.status, 200, JSON.stringify(portraits.body));
    await until(() => !mod.router.isMakingPortraits(id), { label: "the portraits" });
    for (const name of names) {
      const approved = await request(app).post(`/api/cartoon/${id}/cast/${encodeURIComponent(name)}/approve`);
      assert.equal(approved.status, 200, JSON.stringify(approved.body));
      assert.equal(approved.body.project.cast[name].portrait.status, "done");
    }

    // Approve the shot list.
    const listed = await request(app).post(`/api/cartoon/${id}/shots/approve`);
    assert.equal(listed.status, 200, JSON.stringify(listed.body));
    assert.deepEqual(listed.body.project.blockers, []);

    // Run the film with stub clips.
    const film = await request(app).post(`/api/cartoon/${id}/film`).send({});
    assert.equal(film.status, 200, JSON.stringify(film.body));
    await until(() => !mod.film.isFilming(id), { label: "the film" });
    const filmed = (await request(app).get(`/api/cartoon/${id}`)).body.project;
    for (const s of filmed.shots) {
      assert.equal(s.clip?.status, "done", `shot ${s.id}: ${s.clip?.error}`);
      assert.equal(s.clip.speech?.ok, true, `shot ${s.id} speech check matched`);
      assert.ok(s.clip.windows.length > 0, `shot ${s.id} has speech windows`);
    }
    assert.equal(submits.length, shots.length, "one order per shot");
    assert.ok(submits.every((s) => s.generateAudio === true && s.allowTextFallback === false));
    filmed.shots.forEach((s, i) => {
      const sent = submits.find((x) => x.prompt.includes(s.line));
      assert.ok(sent, `shot ${s.id} was ordered`);
      if (s.firstFrame === "chain" && i > 0) assert.equal(sent.firstFrameExists, true, `chained shot ${s.id} starts from a real last frame`);
      else assert.ok(sent.referenceImagePaths.length > 0 && sent.referencesExist, `fresh shot ${s.id} sends the approved portraits`);
    });
    assert.equal(transcribed.length, shotLines.length, "every spoken line was checked");

    // Render with a stub `render` that writes a file.
    const started = await request(app).post(`/api/cartoon/${id}/render`);
    assert.equal(started.status, 200, JSON.stringify(started.body));
    await until(() => !mod.render.isRenderingCartoon(id), { label: "the render" });
    const project = (await request(app).get(`/api/cartoon/${id}`)).body.project;
    const render = project.render;

    assert.equal(render.status, "done", render.error || "");
    assert.equal(renders.length, 1);
    assert.equal(renders[0].compositionId, "Cartoon");
    const props = JSON.stringify(renders[0].inputProps);
    for (const s of shots) assert.ok(props.includes(`clip-${s.id}.mp4`), `the render props carry shot ${s.id}`);
    const stored = mod.store.readProject(dataDir, id);
    const finished = path.join(mod.store.projectOutputDir(outputDir, id), stored.render.file);
    assert.ok(fs.statSync(finished).size > 0, "the finished film is on disk");
    assert.ok(render.durationSec > 0);

    // Money: spent, and settled exactly once per shot with nothing left reserved.
    assert.ok(project.spentUsd > 0);
    const ledger = mod.spend.readLedger(dataDir);
    assert.equal(ledger.clips, shots.length, "one ledger settlement per shot");
    assert.equal(ledger.tokens, shots.length * TOKENS_PER_CLIP);
    assert.deepEqual(ledger.reservations, {});
    assert.ok(Math.abs(ledger.settledUsd - project.spentUsd) < 1e-9, "the project total matches the ledger");
    for (const s of shots) assert.equal(mod.spend.isReserved(dataDir, mod.film.filmLedgerKey(id, s.id)), false);

    // Every clip is in the visual library as a cartoon clip, with its file.
    const library = mod.library.readLibrary(dataDir);
    for (const s of project.shots) {
      const clip = library.find((c) => c.id === s.clip.libraryId);
      assert.ok(clip, `shot ${s.id} is in the library`);
      assert.equal(clip.source.kind, "cartoon");
      assert.equal(clip.source.projectId, id);
      assert.equal(clip.source.shotId, s.id);
      assert.ok(mod.library.clipFile({ dataDir, outputDir }, clip), `shot ${s.id} clip file exists`);
    }
    assert.equal(library.filter((c) => c.source?.kind === "cartoon" && c.source.projectId === id).length, shots.length);

    // Nothing reached the network: every provider was stubbed at the boundary.
    assert.deepEqual(fetchCalls, []);
  });
});
