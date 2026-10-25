import fs from "node:fs";
import path from "node:path";
import { hasLibass } from "../kinetic/capability.js";
import { FONT_DIR } from "../videoFilters.js";
import { STYLES } from "../motion/styles.js";
import { statementsAss, finishArgs } from "../motion/finish.js";
import { runFfmpeg, finishProgressReader, moveInto, tail } from "../motion/render.js";
import { remotionRender, getServeUrl } from "../render/lifecycle.js";
import { startAssetServer } from "../sceneScript/assetServer.js";

/**
 * A Showcase plan + its staged images + audio -> one MP4. The picture is
 * drawn by the MomentShowcase Remotion composition (silent), then the same
 * finish pass as a classic Moment adds the style's grade, the closing scrim,
 * the kinetic captions, the fade and the sound mix.
 *
 * Writes only inside workDir and to `out`, and moves the file to `out` only
 * once the finish has succeeded. Never throws: the result says what happened.
 */
export const COMPOSITION_ID = "MomentShowcase";
const LONG_SEC = 60;
const CAPPED = Object.freeze({ crf: 21, maxrate: "8M", bufsize: "16M" });

/** Past a minute the picture's bitrate is capped, so a long Moment stays a sensible size to post. */
export const encodeFor = (durationSec) => (durationSec > LONG_SEC ? { ...CAPPED } : { crf: 19 });

/**
 * What the shared finish pass reads: the captions, and for a plain finale one closing "shot" so the
 * closing scene is darkened behind its words. An invite dims its own photo, so the calendar card stays bright.
 */
export function finishPlanOf(plan) {
  const { durationSec, fps, w, h, style, energy, seed, captions } = plan;
  const closing = plan.scenes.at(-1);
  const shots = closing.template === "finale" ? [{ role: "end", start: closing.start, overlays: [] }] : [];
  return { durationSec, fps, w, h, style, energy, seed, captions, shots };
}

/** The composition's props: the plan's scenes, the style's palette and each staged image by URL. */
export function showcaseProps(plan, images, url) {
  const style = STYLES[plan.style];
  return {
    fps: plan.fps, w: plan.w, h: plan.h, durationSec: plan.durationSec, shape: plan.shape, beatSec: plan.beatSec,
    scenes: plan.scenes, flashes: plan.flashes,
    invite: plan.invite ? { day: plan.invite.day, label: plan.invite.label } : null,
    palette: style.palette, letterbox: style.letterbox,
    images: images.map((im, i) => ({ card: url(`card-${i}.jpg`), blur: url(`blur-${i}.jpg`), shape: im.shape })),
    fonts: { display: url("display.ttf") },
  };
}

const cancelled = () => ({ ok: false, error: "cancelled" });

async function drawPicture({ plan, images, body, signal, onProgress, remotion, startServer }) {
  const files = { "display.ttf": path.join(FONT_DIR, "Anton.ttf") };
  images.forEach((im, i) => { files[`card-${i}.jpg`] = im.card; files[`blur-${i}.jpg`] = im.blur; });
  let server = null;
  try {
    server = await startServer(files);
    const serveUrl = await remotion.serveUrl();
    if (signal?.aborted) return cancelled();
    await remotion.render({
      serveUrl, compositionId: COMPOSITION_ID, inputProps: showcaseProps(plan, images, server.url), outputLocation: body, signal,
      onProgress: (fraction) => onProgress({ stage: "shots", fraction }),
    });
    return null;
  } catch (err) {
    if (signal?.aborted || /cancel/i.test(String(err?.message))) return cancelled();
    return { ok: false, error: "Rendering failed at the picture.", detail: tail(err?.stack || err?.message || err) };
  } finally {
    await server?.close();
  }
}

export async function renderShowcase({
  plan, images, song = null, voice = null, workDir, out, signal, onProgress = () => {},
  runner = runFfmpeg, remotion = { render: remotionRender, serveUrl: getServeUrl }, startServer = startAssetServer, libass,
}) {
  if (signal?.aborted) return cancelled();
  const finishPlan = finishPlanOf(plan);
  const statementsText = statementsAss(finishPlan);
  if (statementsText && !(libass ?? hasLibass())) {
    return { ok: false, error: "This server can't draw the statements (its ffmpeg has no libass)." };
  }

  const body = path.join(workDir, "body.mp4");
  const pictureFailed = await drawPicture({ plan, images, body, signal, onProgress, remotion, startServer });
  if (pictureFailed) return pictureFailed;
  if (signal?.aborted) return cancelled();

  const statementsPath = statementsText ? path.join(workDir, "statements.ass") : null;
  if (statementsPath) fs.writeFileSync(statementsPath, statementsText, "utf8");
  const final = path.join(workDir, "final.mp4");
  const { args, sideFiles } = finishArgs({
    body, out: final, plan: finishPlan, statementsPath, fxPath: null, song, voice, workDir, encode: encodeFor(plan.durationSec),
  });
  for (const f of sideFiles) fs.writeFileSync(f.path, f.text, "utf8");
  const watch = finishProgressReader(plan.durationSec, (fraction) => onProgress({ stage: "finish", fraction }));
  const r = await runner(["-progress", "pipe:1", "-nostats", ...args], { signal, onStdout: watch });
  if (!r.ok) {
    fs.rmSync(final, { force: true });
    if (r.error === "cancelled" || signal?.aborted) return cancelled();
    return { ok: false, error: "Rendering failed at the finishing pass.", detail: tail(r.stderr || r.error) };
  }
  try {
    moveInto(final, out);
  } catch (err) {
    return { ok: false, error: "Couldn't save the finished video.", detail: String(err?.code || err?.message || err).slice(0, 2000) };
  }
  onProgress({ stage: "finish", fraction: 1 });
  return { ok: true, file: out };
}
