import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { runExclusive } from "../heavyJobGate.js";
import { startAssetServer } from "../sceneScript/assetServer.js";
import { reportRenderFailure } from "../ops/renderFailures.js";

/**
 * The shared life of a project render with Remotion, used by Scene script
 * and Cartoon so a fix lands in both. Each mode supplies only what differs:
 * how to stage its assets, how to build the composition's props, which
 * composition to render and how long the film is planned to be.
 *
 * One render per project at a time, queued behind other heavy jobs
 * (production has no swap). The stage is always removed afterwards. The
 * finished film is written under a temporary name and renamed over the
 * target only once the loudness pass succeeds, so a failed or cancelled
 * re-render never damages the last good film. A cancel is recorded as
 * "cancelled", never reported as a failure.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REMOTION_ENTRY = path.resolve(HERE, "..", "..", "..", "remotion", "src", "index.ts");
export const MAX_UPLOAD_BYTES = 95 * 1024 * 1024;
const PROGRESS_WRITE_MS = 2000;

let bundlePromise = null;
/** Bundle the compositions once per process (or use a prebuilt bundle). */
export function getServeUrl() {
  const prebuilt = process.env.REMOTION_SERVE_URL?.trim();
  if (prebuilt) return Promise.resolve(prebuilt);
  if (!bundlePromise) {
    bundlePromise = import("@remotion/bundler")
      .then(({ bundle }) => bundle({ entryPoint: REMOTION_ENTRY, outDir: path.join(os.tmpdir(), "bf-scene-script-bundle") }))
      .catch((e) => { bundlePromise = null; throw e; });
  }
  return bundlePromise;
}

/** Render one composition of the bundle in headless Chrome. */
export async function remotionRender({ serveUrl, inputProps, outputLocation, onProgress, signal, compositionId }) {
  const { selectComposition, renderMedia, makeCancelSignal } = await import("@remotion/renderer");
  const { cancelSignal, cancel } = makeCancelSignal();
  const onAbort = () => cancel();
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) cancel();
  const chromiumOptions = { enableMultiProcessOnLinux: true };
  try {
    const composition = await selectComposition({ serveUrl, id: compositionId, inputProps, chromiumOptions });
    await renderMedia({
      composition, serveUrl, codec: "h264", crf: 20, audioCodec: "aac", outputLocation, inputProps,
      concurrency: Number(process.env.REMOTION_CONCURRENCY) || 2,
      chromiumOptions, cancelSignal, timeoutInMilliseconds: 120_000,
      onProgress: ({ progress }) => onProgress?.(progress),
    });
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

/** Run ffmpeg; throw a readable error (or "cancelled") when it fails. */
export async function ff(deps, args, signal) {
  const r = await deps.ffmpeg(args, { signal });
  if (!r.ok) throw new Error(r.error === "cancelled" ? "cancelled" : `ffmpeg failed: ${String(r.stderr || r.error || "").slice(-300)}`);
}

export const stopIfCancelled = (signal) => { if (signal?.aborted) throw new Error("Render cancelled."); };

/** A title as a file-name stem: lower case, hyphens, at most 50 characters. */
export const slug = (title, fallback) => String(title || fallback).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || fallback;

async function measureLoudness(deps, file, signal) {
  const r = await deps.ffmpeg(["-hide_banner", "-nostats", "-i", file, "-af", "loudnorm=I=-14:TP=-1:LRA=11:print_format=json", "-f", "null", "-"], { signal });
  const m = /\{[\s\S]*?"input_i"[\s\S]*?\}/.exec(String(r.stderr || ""));
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

/** Two-pass loudness to -14 LUFS, then shrink under the upload limit if needed. */
export async function finishLoudness(deps, raw, out, signal) {
  const stats = await measureLoudness(deps, raw, signal);
  const af = stats
    ? `loudnorm=I=-14:TP=-1:LRA=11:measured_I=${stats.input_i}:measured_TP=${stats.input_tp}:measured_LRA=${stats.input_lra}:measured_thresh=${stats.input_thresh}:offset=${stats.target_offset}:linear=true`
    : "loudnorm=I=-14:TP=-1:LRA=11";
  await ff(deps, ["-y", "-v", "error", "-i", raw, "-c:v", "copy", "-af", af, "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", out], signal);
  if (fs.statSync(out).size > MAX_UPLOAD_BYTES) {
    const smaller = `${out}.small.mp4`;
    await ff(deps, ["-y", "-v", "error", "-i", out, "-c:v", "libx264", "-preset", "medium", "-crf", "25", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", smaller], signal);
    fs.renameSync(smaller, out);
  }
}

/**
 * @typedef {object} RenderSpec
 * @property {string} label log tag and failure kind, e.g. "scene-script"
 * @property {{ readProject: Function, updateProject: Function, projectOutputDir: Function, projectOutputUrl: Function }} store
 * @property {string} compositionId
 * @property {string} fileFallback file-name stem for an untitled project
 * @property {(ctx: object, project: object, stageDir: string, deps: object, signal: AbortSignal) => Promise<{ files: Record<string,string>, names: object }>} stageAssets
 * @property {(project: object, assets: { url: (name: string) => string, names: object }) => object} buildProps
 * @property {(project: object) => number} plannedSec the film's length when the probe gives none
 * @property {(render: object|undefined) => string|null} previousOf the last film's file name, removed after a good render
 * @property {boolean} carryPrevious keep previousOf(render) as `render.previous` through queued, failed and cancelled states
 * @property {string} interrupted the error shown for a render a restart cut off
 * @property {object} defaultDeps { ffmpeg, probe, serveUrl, render }
 */

/** @param {RenderSpec} spec */
export function createRenderLifecycle(spec) {
  const runs = new Map(); // project id -> AbortController
  const { store } = spec;
  const withPrevious = (state, old) => (spec.carryPrevious ? { ...state, previous: spec.previousOf(old) } : state);

  async function renderRaw(ctx, id, project, { stageDir, raw }, deps, signal) {
    fs.rmSync(stageDir, { recursive: true, force: true });
    fs.mkdirSync(stageDir, { recursive: true });
    const { files, names } = await spec.stageAssets(ctx, project, stageDir, deps, signal);
    stopIfCancelled(signal);
    const server = await startAssetServer(files);
    let lastWrite = 0;
    try {
      const inputProps = spec.buildProps(project, { url: server.url, names });
      const serveUrl = await deps.serveUrl();
      stopIfCancelled(signal);
      await deps.render({
        serveUrl, inputProps, outputLocation: raw, signal, compositionId: spec.compositionId,
        onProgress: (p) => {
          if (Date.now() - lastWrite < PROGRESS_WRITE_MS) return;
          lastWrite = Date.now();
          store.updateProject(ctx.dataDir, id, (x) => ({ ...x, render: { ...x.render, status: "rendering", progress: Math.round(p * 100) } }));
        },
      });
    } finally {
      await server.close();
    }
    stopIfCancelled(signal);
  }

  /** The film's length: probed, else the plan. A failed probe never fails a good render. */
  async function durationOf(deps, out, project) {
    let probed = 0;
    try {
      probed = Number(await deps.probe(out));
    } catch {
      probed = 0;
    }
    return probed || spec.plannedSec(project);
  }

  async function runRender(ctx, id, deps, signal) {
    const started = Date.now();
    const project = store.readProject(ctx.dataDir, id);
    if (!project) throw new Error("Project not found.");
    const outDir = store.projectOutputDir(ctx.outputDir, id);
    const stageDir = path.join(outDir, "stage");
    const raw = path.join(stageDir, "raw.mp4");
    const name = `${slug(project.meta?.title, spec.fileFallback)}-${id.slice(0, 8)}.mp4`;
    const out = path.join(outDir, name);
    // Finished under a temporary name, so the last good film survives a failed or cancelled pass.
    const part = path.join(outDir, `${name.slice(0, -".mp4".length)}.part.mp4`);
    try {
      await renderRaw(ctx, id, project, { stageDir, raw }, deps, signal);
      await finishLoudness(deps, raw, part, signal);
      stopIfCancelled(signal);
      fs.renameSync(part, out);
    } finally {
      // The stage holds a raw render of tens to hundreds of MB; never leave it behind.
      fs.rmSync(stageDir, { recursive: true, force: true });
      fs.rmSync(part, { force: true });
      fs.rmSync(`${part}.small.mp4`, { force: true });
    }
    // A renamed title gives a new file name; the old video goes once the new one is safe.
    const previous = spec.previousOf(project.render);
    if (previous && previous !== name && /^[a-z0-9-]+\.mp4$/.test(previous)) fs.rmSync(path.join(outDir, previous), { force: true });
    const durationSec = await durationOf(deps, out, project);
    return {
      status: "done", file: name, url: store.projectOutputUrl(id, name), sizeBytes: fs.statSync(out).size,
      durationSec, renderSec: Math.round((Date.now() - started) / 1000), finishedAt: Date.now(), error: null, progress: 100,
    };
  }

  /** Start a render in the background: the project marked queued, or null when one is running (or it is gone). */
  function start(ctx, id, { deps } = {}) {
    if (runs.has(id)) return null;
    const marked = store.updateProject(ctx.dataDir, id, (p) => ({
      ...p, render: withPrevious({ status: "queued", progress: 0, startedAt: Date.now(), error: null }, p.render),
    }));
    if (!marked) return null;
    const controller = new AbortController();
    runs.set(id, controller);
    const d = { ...spec.defaultDeps, ...deps };
    runExclusive(() => {
      store.updateProject(ctx.dataDir, id, (p) => ({ ...p, render: { ...p.render, status: "rendering" } }));
      return runRender(ctx, id, d, controller.signal);
    }, { signal: controller.signal })
      .then((render) => store.updateProject(ctx.dataDir, id, (p) => ({ ...p, render })))
      .catch((e) => {
        const cancelled = controller.signal.aborted || /cancel/i.test(String(e?.message));
        console.warn(`[${spec.label}] render ${id} ${cancelled ? "cancelled" : "failed"}: ${e?.message || e}`);
        if (!cancelled) reportRenderFailure(spec.label, { projectId: id, error: e?.message || e });
        store.updateProject(ctx.dataDir, id, (p) => ({
          ...p,
          render: withPrevious({
            status: cancelled ? "cancelled" : "error", error: cancelled ? null : String(e?.message || e).slice(0, 400), progress: 0,
          }, p.render),
        }));
      })
      .finally(() => runs.delete(id));
    return marked;
  }

  /** Stop a running render. True when there was one to stop. */
  function cancel(id) {
    const run = runs.get(id);
    if (!run) return false;
    run.abort();
    return true;
  }

  /** After a restart a queued or running render has no worker: show it as stopped. */
  function recover(project) {
    if (!["queued", "rendering"].includes(project?.render?.status) || runs.has(project.id)) return project;
    return { ...project, render: withPrevious({ status: "error", error: spec.interrupted, progress: 0 }, project.render) };
  }

  return { start, cancel, recover, isRendering: (id) => runs.has(id) };
}
