import fs from "fs";
import path from "path";
import { generateBibleImage } from "../imageGen/index.js";
import { portraitPrompt } from "./prompts.js";
import { readProject, updateProject, projectOutputDir, projectOutputUrl } from "./store.js";

/**
 * Character portraits: the picture of each cast member that later goes to the
 * video model as a face reference.
 *
 * Two things about the shared image chain shape this file:
 *  - It caches by seriesId + partNumber, so "Make again" must never reuse a
 *    key. Every attempt takes the next number from `pictureCount` on the
 *    project (bumped atomically in the store) and uses a per-project series.
 *  - It always writes into the owner's OUTPUT_DIR/genImg, whoever is asking.
 *    The result is copied into this project's own pictures/ folder under a new
 *    file name (so a browser never shows a cached old one) and the shared
 *    copy is deleted, so nothing of this user's lingers in the shared folder.
 *
 * A failed attempt keeps the previous picture and records a plain sentence.
 * The cost (IMAGE_USD in model.js) is counted in the estimate, not in the AI
 * video ledger, like other image features.
 */

const NOT_SET_UP = "Picture making is not set up on this server.";
const GENERIC_FAILURE = "The picture could not be made. Please try again in a moment.";

/** A short, file-safe form of a character name. */
function slug(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "character";
}

/** Look a character up by own property only, never through the prototype chain. */
function ownMember(project, name) {
  const cast = project?.cast;
  if (!cast || typeof name !== "string" || !Object.hasOwn(cast, name)) return null;
  return cast[name];
}

/** A copy of the project with one cast member's portrait (and extras) replaced. */
function withPortrait(project, name, portrait, extra = {}) {
  const member = project.cast[name];
  return { ...project, ...(extra.project ? extra.project(project) : {}), cast: { ...project.cast, [name]: { ...member, ...extra.member, portrait } } };
}

function setPortrait(ctx, id, name, makePortraitState, extra) {
  return updateProject(ctx.dataDir, id, (p) => {
    const member = ownMember(p, name);
    if (!member) return null;
    return withPortrait(p, name, makePortraitState(member.portrait || {}), extra);
  });
}

/** Copy the chain's file into the project's pictures/ folder; returns { file, url }. */
function keepPicture(ctx, id, name, attempt, sourcePath) {
  const dir = path.join(projectOutputDir(ctx.outputDir, id), "pictures");
  const fileName = `${slug(name)}-${attempt}.png`;
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(sourcePath, path.join(dir, fileName));
  return { file: `pictures/${fileName}`, url: projectOutputUrl(id, "pictures", fileName) };
}

function removeQuietly(file) {
  try { fs.rmSync(file, { force: true }); } catch { /* best effort */ }
}

/** Ask the image chain for one picture; returns { ok, kept } or { ok:false, error }. */
async function drawPicture(ctx, project, name, attempt, image) {
  const member = project.cast[name];
  let result;
  try {
    result = await image({
      seriesId: `cartoon-${project.id.slice(0, 8)}`,
      partNumber: attempt,
      aspect: "portrait",
      rawPrompt: portraitPrompt({ ...member, name }, project.meta?.style),
    });
  } catch (err) {
    console.warn(`[cartoon] portrait for ${name} failed: ${err?.message || err}`);
    return { ok: false, error: GENERIC_FAILURE };
  }
  if (!result?.ok || !result.path) {
    if (result?.skipped) return { ok: false, error: NOT_SET_UP };
    console.warn(`[cartoon] portrait for ${name} failed: ${result?.error || "no picture returned"}`);
    return { ok: false, error: GENERIC_FAILURE };
  }
  try {
    return { ok: true, kept: keepPicture(ctx, project.id, name, attempt, result.path) };
  } catch (err) {
    console.warn(`[cartoon] saving the portrait for ${name} failed: ${err?.message || err}`);
    return { ok: false, error: GENERIC_FAILURE };
  } finally {
    removeQuietly(result.path);
  }
}

/**
 * Make (or make again) one character's portrait and return the updated
 * project. A new picture is not approved. Throws when the project or the
 * character does not exist (the route turns that into a 404).
 *
 * @param {{ dataDir: string, outputDir: string }} ctx
 * @param {{ id: string }} project
 * @param {string} name
 * @param {{ image?: Function }} [deps] image defaults to generateBibleImage
 */
export async function makePortrait(ctx, project, name, deps = {}) {
  const image = deps.image || generateBibleImage;
  const current = readProject(ctx.dataDir, project?.id);
  const member = ownMember(current, name);
  if (!member) throw new Error(`No character called ${String(name)}.`);

  if (!String(member.look || "").trim()) {
    return setPortrait(ctx, current.id, name, (old) => ({ ...old, file: old.file ?? null, url: old.url ?? null, status: "error", error: `Describe ${name}'s look first.` }));
  }

  const marked = setPortrait(
    ctx,
    current.id,
    name,
    (old) => ({ ...old, file: old.file ?? null, url: old.url ?? null, status: "making", error: null }),
    { project: (p) => ({ pictureCount: (p.pictureCount || 0) + 1 }) },
  );
  const attempt = marked.pictureCount;

  const drawn = await drawPicture(ctx, marked, name, attempt, image);
  if (!drawn.ok) {
    return setPortrait(ctx, current.id, name, (old) => ({ ...old, status: "error", error: drawn.error }));
  }
  return setPortrait(
    ctx,
    current.id,
    name,
    // The style it was drawn in: after a style change it must be made again before approval.
    () => ({ ...drawn.kept, status: "done", error: null, style: marked.meta?.style ?? null }),
    { member: { approved: false } },
  );
}
