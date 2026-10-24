import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { runFfmpeg } from "../motion/render.js";
import { probeAudioDurationSec } from "../story/storyRender.js";
import { runExclusive } from "../heavyJobGate.js";
import { FONT_DIR } from "../videoFilters.js";
import { getClip, clipFile, readLibrary } from "../visualLibrary/store.js";
import { readProject, updateProject, projectOutputDir, projectOutputUrl } from "./projectStore.js";
import { buildRenderData, musicSections } from "./renderData.js";
import { resolveBed } from "./music.js";
import { heartbeatArgs, impactArgs, bedSectionArgs } from "./sfx.js";
import { startAssetServer } from "./assetServer.js";
import { reportRenderFailure } from "../ops/renderFailures.js";

/**
 * Render a voiced, fully shot scene-script project with Remotion:
 * stage the music sections and sound effects, serve every asset from a
 * private local server, render the composition in headless Chrome, then a
 * two-pass loudness pass to -14 LUFS and a size check for the 100 MB upload
 * limit. Renders queue behind other heavy jobs (production has no swap).
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REMOTION_ENTRY = path.resolve(HERE, "..", "..", "..", "remotion", "src", "index.ts");
export const COMPOSITION_ID = "SceneScript";
export const MAX_UPLOAD_BYTES = 95 * 1024 * 1024;
export const FONTS = Object.freeze({
  sans: "Montserrat-Variable.ttf",
  serif: "CormorantGaramond-Variable.ttf",
  serifItalic: "CormorantGaramond-Italic-Variable.ttf",
});

const runs = new Map(); // project id -> AbortController
export const isRendering = (id) => runs.has(id);
export function cancelRender(id) {
  runs.get(id)?.abort();
}

let bundlePromise = null;
/** Bundle the composition once per process (or use a prebuilt bundle). */
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

/** Render one composition of the bundle (Scene script's by default; Cartoon passes its own id). */
export async function remotionRender({ serveUrl, inputProps, outputLocation, onProgress, signal, compositionId = COMPOSITION_ID }) {
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

const defaultDeps = Object.freeze({
  ffmpeg: runFfmpeg,
  probe: probeAudioDurationSec,
  serveUrl: getServeUrl,
  render: remotionRender,
});

/** What stops this project from rendering, as sentences for the page. */
export function renderBlockers(ctx, project, { clips = readLibrary(ctx.dataDir) } = {}) {
  const out = [];
  if (!project.timeline || project.voice?.status !== "done" || project.timeline.missing?.length) {
    out.push("Voice every line first.");
  }
  const missing = project.shots.filter((s) => !(s.clip?.status === "done" && s.clip.libraryId));
  if (missing.length) out.push(`${missing.length} shot(s) have no clip yet.`);
  const ids = new Set(clips.map((c) => c.id));
  const lost = project.shots.filter((s) => s.clip?.libraryId && !ids.has(s.clip.libraryId));
  if (lost.length) out.push(`${lost.length} shot(s) use a clip that was removed from the library.`);
  const beds = project.music.cues.filter((c) => !resolveBed(ctx.dataDir, c.bed));
  if (beds.length) out.push(`${beds.length} music cue(s) have no playable bed.`);
  return out;
}

async function ff(deps, args, signal) {
  const r = await deps.ffmpeg(args, { signal });
  if (!r.ok) throw new Error(r.error === "cancelled" ? "cancelled" : `ffmpeg failed: ${String(r.stderr || r.error || "").slice(-300)}`);
}

async function stageAssets(ctx, project, stageDir, deps, signal) {
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });
  const files = {};
  const names = { voice: {}, music: {}, clips: {}, fonts: {} };
  const voiceDir = path.join(projectOutputDir(ctx.outputDir, project.id), "voice");
  for (const l of project.lines) {
    names.voice[l.id] = `voice-${l.id}.wav`;
    files[names.voice[l.id]] = path.join(voiceDir, l.audio.file);
  }
  for (const s of project.shots) {
    names.clips[s.id] = `clip-${s.id}.mp4`;
    files[names.clips[s.id]] = clipFile(ctx, getClip(ctx.dataDir, s.clip.libraryId));
  }
  for (const section of musicSections(project, project.timeline)) {
    const name = `music-${section.id}.wav`;
    await ff(deps, bedSectionArgs(resolveBed(ctx.dataDir, section.bed), path.join(stageDir, name), {
      offsetSec: section.offsetSec, durationSec: section.to - section.from,
    }), signal);
    names.music[section.id] = name;
    files[name] = path.join(stageDir, name);
    if (section.heartbeat && !names.heartbeat) {
      await ff(deps, heartbeatArgs(path.join(stageDir, "heartbeat.wav"), section.to - section.from), signal);
      names.heartbeat = "heartbeat.wav";
      files["heartbeat.wav"] = path.join(stageDir, "heartbeat.wav");
    }
  }
  if (project.timeline.drop) {
    await ff(deps, impactArgs(path.join(stageDir, "impact.wav")), signal);
    names.impact = "impact.wav";
    files["impact.wav"] = path.join(stageDir, "impact.wav");
  }
  for (const [k, f] of Object.entries(FONTS)) {
    names.fonts[k] = f;
    files[f] = path.join(FONT_DIR, f);
  }
  return { files, names };
}

async function measureLoudness(deps, file, signal) {
  const r = await deps.ffmpeg(["-hide_banner", "-nostats", "-i", file, "-af", "loudnorm=I=-14:TP=-1:LRA=11:print_format=json", "-f", "null", "-"], { signal });
  const m = /\{[\s\S]*?"input_i"[\s\S]*?\}/.exec(String(r.stderr || ""));
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

/** Two-pass loudness to -14 LUFS, then shrink under the upload limit if needed. Cartoon reuses it. */
async function finish(deps, raw, out, signal) {
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

export { finish as finishLoudness };

const slug = (t) => String(t || "scene-script").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "scene-script";

const stopIfCancelled = (signal) => { if (signal?.aborted) throw new Error("Render cancelled."); };

async function renderRaw(ctx, id, project, { stageDir, raw }, deps, signal) {
  const { files, names } = await stageAssets(ctx, project, stageDir, deps, signal);
  stopIfCancelled(signal);
  const server = await startAssetServer(files);
  let lastWrite = 0;
  try {
    const inputProps = buildRenderData(project, { url: server.url, names });
    const serveUrl = await deps.serveUrl();
    stopIfCancelled(signal);
    await deps.render({
      serveUrl, inputProps, outputLocation: raw, signal,
      onProgress: (p) => {
        if (Date.now() - lastWrite < 2000) return;
        lastWrite = Date.now();
        updateProject(ctx.dataDir, id, (x) => ({ ...x, render: { ...x.render, status: "rendering", progress: Math.round(p * 100) } }));
      },
    });
  } finally {
    await server.close();
  }
  stopIfCancelled(signal);
}

async function runRender(ctx, id, deps, signal) {
  const started = Date.now();
  const project = readProject(ctx.dataDir, id);
  const outDir = projectOutputDir(ctx.outputDir, id);
  const stageDir = path.join(outDir, "stage");
  const raw = path.join(stageDir, "raw.mp4");
  const name = `${slug(project.meta?.title)}-${id.slice(0, 8)}.mp4`;
  const out = path.join(outDir, name);
  try {
    await renderRaw(ctx, id, project, { stageDir, raw }, deps, signal);
    await finish(deps, raw, out, signal);
  } finally {
    // The stage holds a raw render of hundreds of MB; never leave it behind.
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
  // A renamed title gives a new file name; the old video goes once the new one is safe.
  const previous = project.render?.file;
  if (previous && previous !== name && /^[a-z0-9-]+\.mp4$/.test(previous)) fs.rmSync(path.join(outDir, previous), { force: true });
  const durationSec = Number(await deps.probe(out)) || project.timeline.total;
  return {
    status: "done", file: name, url: projectOutputUrl(id, name), sizeBytes: fs.statSync(out).size,
    durationSec, renderSec: Math.round((Date.now() - started) / 1000), finishedAt: Date.now(), error: null, progress: 100,
  };
}

/**
 * Start a render in the background. Returns the project marked queued, or
 * null when a render is already running for it. Callers check
 * renderBlockers first.
 */
export function startRender(ctx, id, { deps } = {}) {
  if (runs.has(id)) return null;
  const marked = updateProject(ctx.dataDir, id, (p) => ({ ...p, render: { status: "queued", progress: 0, startedAt: Date.now(), error: null } }));
  if (!marked) return null;
  const controller = new AbortController();
  runs.set(id, controller);
  const d = { ...defaultDeps, ...deps };
  runExclusive(() => {
    updateProject(ctx.dataDir, id, (p) => ({ ...p, render: { ...p.render, status: "rendering" } }));
    return runRender(ctx, id, d, controller.signal);
  }, { signal: controller.signal })
    .then((render) => updateProject(ctx.dataDir, id, (p) => ({ ...p, render })))
    .catch((e) => {
      const cancelled = controller.signal.aborted || /cancel/i.test(String(e?.message));
      console.warn(`[scene-script] render ${id} ${cancelled ? "cancelled" : "failed"}: ${e?.message || e}`);
      if (!cancelled) reportRenderFailure("scene-script", { projectId: id, error: e?.message || e });
      updateProject(ctx.dataDir, id, (p) => ({
        ...p,
        render: { status: cancelled ? "cancelled" : "error", error: cancelled ? null : String(e?.message || e).slice(0, 400), progress: 0 },
      }));
    })
    .finally(() => runs.delete(id));
  return marked;
}

/** After a restart a queued or running render has no worker: mark it stopped. */
export function recoverInterruptedRender(project) {
  if (!["queued", "rendering"].includes(project?.render?.status) || runs.has(project.id)) return project;
  return { ...project, render: { status: "error", error: "Interrupted by a server restart. Render again; clips and voices are kept.", progress: 0 } };
}
