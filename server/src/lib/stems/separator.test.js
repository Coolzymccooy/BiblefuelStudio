import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "events";
import fs from "fs";
import os from "os";
import path from "path";
import {
  MODELS, stemsCli, buildSeparatorArgs, parseProgress,
  separatorAvailable, removeVocals, _setSpawnImpl, _resetSpawnImpl, _resetAvailability,
  _setKillGraceMs, _resetKillGraceMs,
} from "./separator.js";

function fakeProc({ code = 0, stdout = "", stderr = "", onSpawn } = {}) {
  return (cmd, args, opts) => {
    onSpawn?.(cmd, args, opts);
    const p = new EventEmitter();
    p.stdout = new EventEmitter();
    p.stderr = new EventEmitter();
    p.kill = () => { p.killed = true; setImmediate(() => p.emit("close", null)); };
    setImmediate(() => {
      if (stdout) p.stdout.emit("data", Buffer.from(stdout));
      if (stderr) p.stderr.emit("data", Buffer.from(stderr));
      p.emit("close", code);
    });
    return p;
  };
}

describe("stemsCli", () => {
  test("unset means the feature is off", () => assert.equal(stemsCli({}), null));
  test("reads STEMS_CLI", () => assert.equal(stemsCli({ STEMS_CLI: " C:\\v\\python.exe " }), "C:\\v\\python.exe"));
});

describe("buildSeparatorArgs", () => {
  const input = path.resolve("/music/My Song's \"Best\".mp3");
  const outDir = path.resolve("/work/job 1");

  test("best quality uses the MDX-Net instrumental model and asks only for the instrumental", () => {
    const args = buildSeparatorArgs({ input, outDir, quality: "best" });
    assert.equal(args[0], input);
    assert.equal(args[args.indexOf("--model_filename") + 1], MODELS.best);
    assert.equal(args[args.indexOf("--single_stem") + 1], "Instrumental");
    assert.equal(args[args.indexOf("--output_dir") + 1], outDir);
  });

  test("both qualities use a model that writes an Instrumental stem (Demucs does not)", () => {
    assert.match(MODELS.best, /Inst/);
    assert.match(MODELS.fast, /Inst/);
  });

  test("fast lowers the overlap; best keeps the model default; unknown quality is best", () => {
    const fast = buildSeparatorArgs({ input, outDir, quality: "fast" });
    assert.equal(fast[fast.indexOf("--mdx_overlap") + 1], "0.1");
    assert.equal(buildSeparatorArgs({ input, outDir, quality: "best" }).includes("--mdx_overlap"), false);
    const unknown = buildSeparatorArgs({ input, outDir, quality: "ultra" });
    assert.equal(unknown.includes(MODELS.best), true);
    assert.equal(unknown.includes("--mdx_overlap"), false);
  });

  test("a path with spaces and quotes stays one argument", () => {
    assert.ok(buildSeparatorArgs({ input, outDir, quality: "best" }).includes(input));
  });

  test("the model folder is passed when set", () => {
    const args = buildSeparatorArgs({ input, outDir, quality: "best", modelDir: path.resolve("/models") });
    assert.equal(args[args.indexOf("--model_file_dir") + 1], path.resolve("/models"));
  });

  test("refuses a relative input (it could be read as a flag)", () => {
    assert.throws(() => buildSeparatorArgs({ input: "-rf", outDir, quality: "best" }), /absolute/);
  });
});

describe("parseProgress", () => {
  test("reads the last percentage in a chunk", () => {
    assert.equal(parseProgress(" 12%|█▏        | 3/25 [00:05<00:40]\r 48%|████▊     | 12/25"), 48);
  });
  test("null when there is none", () => assert.equal(parseProgress("Loading model..."), null));
});

describe("separatorAvailable", () => {
  afterEach(() => { _resetSpawnImpl(); _resetAvailability(); _resetKillGraceMs(); delete process.env.STEMS_CLI; });

  test("off when STEMS_CLI is unset", async () => {
    delete process.env.STEMS_CLI;
    assert.equal((await separatorAvailable()).ok, false);
  });

  test("on when --version exits 0, spawned without a shell", async () => {
    process.env.STEMS_CLI = "C:\\v\\python.exe";
    let seen;
    _setSpawnImpl(fakeProc({ stdout: "audio-separator 0.30.1", onSpawn: (cmd, args, opts) => { seen = { cmd, args, opts }; } }));
    const r = await separatorAvailable();
    assert.equal(r.ok, true);
    assert.equal(seen.cmd, "C:\\v\\python.exe");
    assert.deepEqual(seen.args, ["--version"]);
    assert.equal(seen.opts.shell, false);
  });

  test("off when --version fails", async () => {
    process.env.STEMS_CLI = "C:\\v\\python.exe";
    _setSpawnImpl(fakeProc({ code: 1 }));
    assert.equal((await separatorAvailable()).ok, false);
  });

  test("off, not hung, when --version never answers", async () => {
    process.env.STEMS_CLI = "C:\\v\\python.exe";
    _setKillGraceMs(20); // keep the abort's grace wait short for this test
    _setSpawnImpl(() => { const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = new EventEmitter(); p.kill = () => {}; return p; });
    const r = await separatorAvailable({ timeoutMs: 20 });
    assert.equal(r.ok, false);
  });

  test("a transient failure (timeout) is not cached; the next call re-probes and can succeed", async () => {
    process.env.STEMS_CLI = "C:\\v\\python.exe";
    _setKillGraceMs(20);
    _setSpawnImpl(() => { const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = new EventEmitter(); p.kill = () => {}; return p; });
    const r1 = await separatorAvailable({ timeoutMs: 20 });
    assert.equal(r1.ok, false);
    _setSpawnImpl(fakeProc({ stdout: "audio-separator 0.47.0" }));
    const r2 = await separatorAvailable();
    assert.equal(r2.ok, true);
    assert.equal(r2.version, "0.47.0");
  });

  test("a successful probe is cached and not re-spawned on the next call", async () => {
    process.env.STEMS_CLI = "C:\\v\\python.exe";
    let calls = 0;
    _setSpawnImpl(fakeProc({ stdout: "audio-separator 0.47.0", onSpawn: () => { calls += 1; } }));
    const r1 = await separatorAvailable();
    assert.equal(r1.ok, true);
    assert.equal(calls, 1);
    _setSpawnImpl(() => { throw new Error("should not be called again"); });
    const r2 = await separatorAvailable();
    assert.equal(r2.ok, true);
    assert.equal(calls, 1);
  });
});

describe("removeVocals", () => {
  afterEach(() => { _resetSpawnImpl(); _resetKillGraceMs(); delete process.env.STEMS_CLI; });

  test("decodes the song to WAV first, separates that, converts the instrumental to m4a, reports progress and cleans up", async () => {
    process.env.STEMS_CLI = "C:\v\python.exe";
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bf-stems-"));
    const workDir = path.join(root, "work");
    const input = path.join(root, "song.m4a");
    const outPath = path.join(root, "instrumental-1.m4a");
    const calls = [];
    const progress = [];
    _setSpawnImpl((cmd, args, opts) => {
      calls.push({ cmd, args });
      if (cmd !== "C:\v\python.exe") fs.writeFileSync(args[args.length - 1], "out"); // ffmpeg writes its last arg
      else fs.writeFileSync(path.join(workDir, "source_(Instrumental)_model.wav"), "wav");
      return fakeProc({ stderr: cmd === "C:\v\python.exe" ? " 50%|█████ | 5/10" : "" })(cmd, args, opts);
    });
    const result = await removeVocals({ input, outPath, workDir, quality: "fast", onProgress: (p) => progress.push(p) });
    assert.equal(result, outPath);
    assert.equal(fs.existsSync(outPath), true);
    assert.equal(fs.existsSync(workDir), false, "work files removed");
    assert.deepEqual(progress, [50]);
    assert.equal(calls.length, 3);
    const [decode, separate, encode] = calls;
    // The separator reads through libsndfile, which cannot open m4a/AAC.
    assert.ok(decode.args.includes(input));
    assert.equal(decode.args[decode.args.length - 1], path.join(workDir, "source.wav"));
    assert.equal(separate.cmd, "C:\v\python.exe");
    assert.equal(separate.args[0], path.join(workDir, "source.wav"));
    assert.ok(encode.args.includes(path.join(workDir, "source_(Instrumental)_model.wav")));
    assert.ok(encode.args.includes("aac"));
  });

  test("a song ffmpeg cannot read fails with a plain message", async () => {
    process.env.STEMS_CLI = "C:\v\python.exe";
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bf-stems-"));
    _setSpawnImpl(fakeProc({ code: 1, stderr: "Invalid data found when processing input" }));
    await assert.rejects(
      removeVocals({ input: path.join(root, "s.m4a"), outPath: path.join(root, "o.m4a"), workDir: path.join(root, "w"), quality: "best" }),
      /could not read this song file.*Invalid data/s,
    );
  });

  test("fails clearly when the separator writes no instrumental", async () => {
    process.env.STEMS_CLI = "C:\\v\\python.exe";
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bf-stems-"));
    _setSpawnImpl(fakeProc());
    await assert.rejects(
      removeVocals({ input: path.join(root, "s.mp3"), outPath: path.join(root, "o.m4a"), workDir: path.join(root, "w"), quality: "best" }),
      /no instrumental/,
    );
  });

  test("a non-zero exit is an error carrying the tail of stderr", async () => {
    process.env.STEMS_CLI = "C:\\v\\python.exe";
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bf-stems-"));
    _setSpawnImpl(fakeProc({ code: 2, stderr: "CUDA? no. out of memory" }));
    await assert.rejects(
      removeVocals({ input: path.join(root, "s.mp3"), outPath: path.join(root, "o.m4a"), workDir: path.join(root, "w"), quality: "best" }),
      /out of memory/,
    );
  });

  test("an abort kills the process", async () => {
    process.env.STEMS_CLI = "C:\\v\\python.exe";
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bf-stems-"));
    let proc;
    _setSpawnImpl(() => { proc = new EventEmitter(); proc.stdout = new EventEmitter(); proc.stderr = new EventEmitter(); proc.kill = () => { proc.killed = true; setImmediate(() => proc.emit("close", null)); }; return proc; });
    const ctrl = new AbortController();
    const run = removeVocals({ input: path.join(root, "s.mp3"), outPath: path.join(root, "o.m4a"), workDir: path.join(root, "w"), quality: "best", signal: ctrl.signal });
    await new Promise((r) => setImmediate(r));
    ctrl.abort();
    await assert.rejects(run, /Cancelled/);
    assert.equal(proc.killed, true);
  });

  test("abort waits for the process to actually close before rejecting", async () => {
    process.env.STEMS_CLI = "C:\\v\\python.exe";
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bf-stems-"));
    let proc;
    _setSpawnImpl(() => {
      proc = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      // Simulate a process that takes a little while to actually die.
      proc.kill = () => { proc.killed = true; setTimeout(() => proc.emit("close", null), 30); };
      return proc;
    });
    const ctrl = new AbortController();
    const run = removeVocals({ input: path.join(root, "s.mp3"), outPath: path.join(root, "o.m4a"), workDir: path.join(root, "w"), quality: "best", signal: ctrl.signal });
    run.catch(() => {}); // observed below; avoid an unhandled-rejection warning while we probe timing
    await new Promise((r) => setImmediate(r));
    ctrl.abort();
    let settled = false;
    run.then(() => { settled = true; }, () => { settled = true; });
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(settled, false, "should still be waiting for the process to close");
    await assert.rejects(run, /Cancelled/);
    assert.equal(proc.killed, true);
  });

  test("gives up waiting after the kill grace period and still rejects Cancelled", async () => {
    process.env.STEMS_CLI = "C:\\v\\python.exe";
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bf-stems-"));
    _setKillGraceMs(20);
    _setSpawnImpl(() => {
      const proc = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => { proc.killed = true; }; // never emits close
      return proc;
    });
    const ctrl = new AbortController();
    const run = removeVocals({ input: path.join(root, "s.mp3"), outPath: path.join(root, "o.m4a"), workDir: path.join(root, "w"), quality: "best", signal: ctrl.signal });
    await new Promise((r) => setImmediate(r));
    ctrl.abort();
    await assert.rejects(run, /Cancelled/);
  });

  test("progress emitted after abort is ignored", async () => {
    process.env.STEMS_CLI = "C:\\v\\python.exe";
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bf-stems-"));
    let proc;
    const progress = [];
    _setSpawnImpl(() => {
      proc = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = () => { proc.killed = true; setImmediate(() => proc.emit("close", null)); };
      return proc;
    });
    const ctrl = new AbortController();
    const run = removeVocals({ input: path.join(root, "s.mp3"), outPath: path.join(root, "o.m4a"), workDir: path.join(root, "w"), quality: "best", signal: ctrl.signal, onProgress: (p) => progress.push(p) });
    await new Promise((r) => setImmediate(r));
    ctrl.abort();
    await assert.rejects(run, /Cancelled/);
    proc.stderr.emit("data", Buffer.from(" 99%|"));
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(progress, []);
  });

  test("a workDir cleanup failure does not replace the real error", async () => {
    process.env.STEMS_CLI = "C:\\v\\python.exe";
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "bf-stems-"));
    _setSpawnImpl(fakeProc({ code: 2, stderr: "boom: separator exploded" }));
    const originalRmSync = fs.rmSync;
    fs.rmSync = () => { throw new Error("EBUSY: resource busy or locked"); };
    try {
      await assert.rejects(
        removeVocals({ input: path.join(root, "s.mp3"), outPath: path.join(root, "o.m4a"), workDir: path.join(root, "w"), quality: "best" }),
        /boom: separator exploded/,
      );
    } finally {
      fs.rmSync = originalRmSync;
    }
  });
});
