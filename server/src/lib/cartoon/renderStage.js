import fs from "fs";
import path from "path";
import { runFfmpeg } from "../motion/render.js";
import { probeAudioDurationSec } from "../story/storyRender.js";
import { runExclusive } from "../heavyJobGate.js";
import { FONT_DIR } from "../videoFilters.js";
import { getClip, clipFile, readLibrary } from "../visualLibrary/store.js";
import { resolveBed } from "../sceneScript/music.js";
import { bedSectionArgs } from "../sceneScript/sfx.js";
import { startAssetServer } from "../sceneScript/assetServer.js";
import { getServeUrl, remotionRender, finishLoudness, FONTS } from "../sceneScript/renderStage.js";
import { reportRenderFailure } from "../ops/renderFailures.js";
import { readProject, updateProject, projectOutputDir, projectOutputUrl } from "./store.js";
import { buildCartoonRenderData, filmTimeline } from "./renderData.js";
import { MAX_FILM_SEC } from "./plan.js";

/**
 * Render a filmed cartoon to the finished video (spec section 7.7), the same
 * way Scene script renders: stage the clips, the music bed (cut to the film's
 * length) and the fonts; serve them from a private local server; render the
 * "Cartoon" composition in headless Chrome; then the shared two-pass loudness
 * finish to -14 LUFS. Renders queue behind other heavy jobs (production has
 * no swap). One render per project at a time; a restart leaves no worker, so
 * a render left running is shown as stopped.
 */

export const COMPOSITION_ID = "Cartoon";

const runs = new Map(); // project id -> AbortController
export const isRenderingCartoon = (id) => runs.has(id);

/** Stop a running render. True when there was one to stop. */
export function cancelCartoonRender(id) {
  const run = runs.get(id);
  if (!run) return false;
  run.abort();
  return true;
}

const defaultDeps = Object.freeze({
  ffmpeg: runFfmpeg,
  probe: probeAudioDurationSec,
  serveUrl: getServeUrl,
  render: remotionRender,
});

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** What stops this cartoon from rendering, as sentences for the page. */
export function cartoonRenderBlockers(ctx, project, { clips = readLibrary(ctx.dataDir) } = {}) {
  const out = [];
  const shots = project.shots || [];
  const missing = shots.filter((s) => !(s.clip?.status === "done" && s.clip.libraryId));
  if (missing.length) out.push(`${plural(missing.length, "shot has", "shots have")} no clip yet. Film ${missing.length === 1 ? "it" : "them"} first.`);
  const byId = new Map(clips.map((c) => [c.id, c]));
  const lost = shots.filter((s) => s.clip?.libraryId && (!byId.has(s.clip.libraryId) || !clipFile(ctx, byId.get(s.clip.libraryId))));
  if (lost.length) {
    out.push(lost.length === 1
      ? "1 shot uses a clip that was removed from the library. Re-make it."
      : `${lost.length} shots use clips that were removed from the library. Re-make them.`);
  }
  if (project.music?.bed && !resolveBed(ctx.dataDir, project.music.bed)) {
    out.push("The music bed can't be found. Choose another, or turn the music off.");
  }
  if (!missing.length) {
    const { total, fits } = filmTimeline(project);
    if (!fits) out.push(`The film runs ${total.toFixed(1)} s with its cards; the limit is ${MAX_FILM_SEC} s. Shorten a line and re-make its shot.`);
  }
  return out;
}

/** What the page should mention but that does not stop a render: shots made from an out-of-date frame. */
export function cartoonRenderWarnings(project) {
  return (project.shots || [])
    .map((s, i) => (s.clip?.status === "done" && s.clip.stale
      ? `Shot ${i + 1} starts from the old last frame of the shot before. Re-make it, or render it as it is.`
      : null))
    .filter(Boolean);
}

async function ff(deps, args, signal) {
  const r = await deps.ffmpeg(args, { signal });
  if (!r.ok) throw new Error(r.error === "cancelled" ? "cancelled" : `ffmpeg failed: ${String(r.stderr || r.error || "").slice(-300)}`);
}

async function stageAssets(ctx, project, total, stageDir, deps, signal) {
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });
  const files = {};
  const names = { clips: {}, bed: null, fonts: {} };
  for (const s of project.shots) {
    const clip = getClip(ctx.dataDir, s.clip?.libraryId);
    const file = clip ? clipFile(ctx, clip) : null;
    if (!file) throw new Error(`The clip for shot ${s.id} is missing from the library. Re-make it.`);
    names.clips[s.id] = `clip-${s.id}.mp4`;
    files[names.clips[s.id]] = file;
  }
  const bed = project.music?.bed ? resolveBed(ctx.dataDir, project.music.bed) : null;
  if (bed) {
    const staged = path.join(stageDir, "bed.wav");
    await ff(deps, bedSectionArgs(bed, staged, { offsetSec: 0, durationSec: total }), signal);
    names.bed = "bed.wav";
    files["bed.wav"] = staged;
  }
  for (const [k, f] of Object.entries(FONTS)) {
    names.fonts[k] = f;
    files[f] = path.join(FONT_DIR, f);
  }
  return { files, names };
}

/**
 * The last finished video's file name, carried through queued, failed and
 * cancelled states so the next good render can remove it (a new title gives
 * a new name).
 */
const previousFile = (render) => render?.file || render?.previous || null;

const slug = (t) => String(t || "cartoon").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "cartoon";

const stopIfCancelled = (signal) => { if (signal?.aborted) throw new Error("Render cancelled."); };

async function renderRaw(ctx, id, project, { stageDir, raw }, deps, signal) {
  const { total } = filmTimeline(project);
  const { files, names } = await stageAssets(ctx, project, total, stageDir, deps, signal);
  stopIfCancelled(signal);
  const server = await startAssetServer(files);
  let lastWrite = 0;
  try {
    const inputProps = buildCartoonRenderData(project, { url: server.url, names });
    const serveUrl = await deps.serveUrl();
    stopIfCancelled(signal);
    await deps.render({
      serveUrl, inputProps, outputLocation: raw, signal, compositionId: COMPOSITION_ID,
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
  return total;
}

async function runRender(ctx, id, deps, signal) {
  const started = Date.now();
  const project = readProject(ctx.dataDir, id);
  if (!project) throw new Error("Cartoon not found.");
  const outDir = projectOutputDir(ctx.outputDir, id);
  const stageDir = path.join(outDir, "stage");
  const raw = path.join(stageDir, "raw.mp4");
  const name = `${slug(project.meta?.title)}-${id.slice(0, 8)}.mp4`;
  const out = path.join(outDir, name);
  let total;
  try {
    total = await renderRaw(ctx, id, project, { stageDir, raw }, deps, signal);
    await finishLoudness(deps, raw, out, signal);
  } finally {
    // The stage holds a raw render of tens of MB; never leave it behind.
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
  // A renamed title gives a new file name; the old video goes once the new one is safe.
  const previous = previousFile(project.render);
  if (previous && previous !== name && /^[a-z0-9-]+\.mp4$/.test(previous)) fs.rmSync(path.join(outDir, previous), { force: true });
  const durationSec = Number(await deps.probe(out)) || total;
  return {
    status: "done", file: name, url: projectOutputUrl(id, name), sizeBytes: fs.statSync(out).size,
    durationSec, renderSec: Math.round((Date.now() - started) / 1000), finishedAt: Date.now(), error: null, progress: 100,
  };
}

/**
 * Start a render in the background. Returns the project marked queued, or
 * null when a render is already running for it (or the project is gone).
 * Callers check cartoonRenderBlockers first.
 */
export function startCartoonRender(ctx, id, { deps } = {}) {
  if (runs.has(id)) return null;
  const marked = updateProject(ctx.dataDir, id, (p) => ({
    ...p, render: { status: "queued", progress: 0, startedAt: Date.now(), error: null, previous: previousFile(p.render) },
  }));
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
      console.warn(`[cartoon] render ${id} ${cancelled ? "cancelled" : "failed"}: ${e?.message || e}`);
      if (!cancelled) reportRenderFailure("cartoon", { projectId: id, error: e?.message || e });
      updateProject(ctx.dataDir, id, (p) => ({
        ...p,
        render: {
          status: cancelled ? "cancelled" : "error", error: cancelled ? null : String(e?.message || e).slice(0, 400), progress: 0,
          previous: previousFile(p.render),
        },
      }));
    })
    .finally(() => runs.delete(id));
  return marked;
}

/** After a restart a queued or running render has no worker: show it as stopped. */
export function recoverInterruptedCartoonRender(project) {
  if (!["queued", "rendering"].includes(project?.render?.status) || runs.has(project.id)) return project;
  return {
    ...project,
    render: { status: "error", error: "Interrupted by a server restart. Render again; the clips are kept.", progress: 0, previous: previousFile(project.render) },
  };
}
