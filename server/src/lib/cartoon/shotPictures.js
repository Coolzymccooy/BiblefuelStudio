import fs from "fs";
import path from "path";
import { getClip, clipFile } from "../visualLibrary/store.js";
import { referencedCast } from "./prompts.js";
import { projectOutputDir } from "./store.js";

/**
 * What pictures a cartoon shot is ordered with (spec section 7.6, C0 ruling).
 *
 * A fresh shot sends the approved portraits of its characters as reference
 * pictures, so each face holds in a new place. A chained shot continues the
 * shot before it, so it starts from that clip's last frame and sends nothing
 * else. When the pictures cannot be had, the shot is not ordered and nothing
 * is charged: the result says why, as the shot's end state.
 */

const NO_FRAME = "The starting picture for this shot could not be made. Make the shot before it again.";
const BAD_PICTURE = "A character picture could not be read. Make the portrait again.";
export const waitingFor = (n) => `Waiting for shot ${n}`;
const approveFirst = (name) => `Approve ${name}'s portrait first.`;

/** Whether the shot at `index` starts from the last frame of the shot before it. */
export const isChained = (shot, index) => shot?.firstFrame === "chain" && index > 0;

/** The shot as it is ordered: the first shot has no shot before it, so it is always fresh. */
export const asOrdered = (shot, index) => (isChained(shot, index) ? shot : { ...shot, firstFrame: "fresh" });

/** Who a fresh shot would show if every portrait were approved: the speaker first, then the scene. */
function wantedCast(project, shot) {
  const cast = Object.fromEntries(Object.entries(project.cast || {})
    .map(([name, member]) => [name, { ...member, approved: true, portrait: member?.portrait || {} }]));
  return referencedCast({ ...project, cast }, { ...shot, firstFrame: "fresh" });
}

/** The last frame of a clip as a PNG, or null when ffmpeg made none (missing or empty). Never throws. */
export async function lastFrameOf(deps, clipFilePath, out) {
  try {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.rmSync(out, { force: true });
    const made = await deps.ffmpeg(["-y", "-v", "error", "-sseof", "-0.1", "-i", clipFilePath, "-frames:v", "1", out]);
    return made?.ok && fs.existsSync(out) && fs.statSync(out).size > 0 ? out : null;
  } catch {
    return null;
  }
}

/** A chained shot's first frame: the last frame of the shot before it, which must be done. */
async function startingFrame(ctx, project, index, deps) {
  const shot = project.shots[index];
  const parent = project.shots[index - 1];
  if (parent.clip?.status !== "done" || !parent.clip.libraryId) return { ok: false, status: "waiting", error: waitingFor(index) };
  const clip = getClip(ctx.dataDir, parent.clip.libraryId);
  const source = clip ? clipFile(ctx, clip) : null;
  const name = `${String(shot.id).replace(/[^A-Za-z0-9_-]/g, "") || "shot"}-last.png`;
  const frame = source ? await lastFrameOf(deps, source, path.join(projectOutputDir(ctx.outputDir, project.id), "frames", name)) : null;
  return frame ? { ok: true, input: { firstFramePath: frame } } : { ok: false, error: NO_FRAME };
}

/** A fresh shot's reference pictures: the approved portraits named when it was queued, inside the project folder. */
function referencePictures(ctx, project, shot) {
  const names = Array.isArray(shot.clip?.references) ? shot.clip.references : [];
  if (!names.length) {
    const wanted = wantedCast(project, shot);
    return wanted.length ? { ok: false, error: approveFirst(wanted[0]) } : { ok: true, input: { referenceImagePaths: [] } };
  }
  const base = projectOutputDir(ctx.outputDir, project.id);
  const paths = [];
  for (const name of names) {
    const member = Object.hasOwn(project.cast || {}, name) ? project.cast[name] : null;
    if (!member?.approved || !member.portrait?.file) return { ok: false, error: approveFirst(name) };
    const full = path.resolve(base, member.portrait.file);
    const rel = path.relative(base, full);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return { ok: false, error: BAD_PICTURE };
    paths.push(full);
  }
  return { ok: true, input: { referenceImagePaths: paths } };
}

/**
 * The submit options for the shot at `index`: `{ ok: true, input }` with
 * `firstFramePath` (chained) or `referenceImagePaths` (fresh), else
 * `{ ok: false, status?, error }` and the shot is not ordered.
 */
export function picturesFor(ctx, project, index, deps) {
  const shot = project.shots[index];
  return isChained(shot, index) ? startingFrame(ctx, project, index, deps) : Promise.resolve(referencePictures(ctx, project, shot));
}
