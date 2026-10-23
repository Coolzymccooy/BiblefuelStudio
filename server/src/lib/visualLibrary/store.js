import fs from "fs";
import path from "path";
import crypto from "crypto";

/**
 * The visual library: every paid AI clip, kept with the prompt that made it,
 * so it can be reused in another video at no cost or re-rolled from an
 * edited prompt. A re-roll adds a clip; nothing here is deleted except by an
 * explicit remove.
 *
 * Index: <dataDir>/visual-library.json. Files: <outputDir>/visual-library/
 * <clipId>/clip.mp4 (+ poster.jpg). Clip ids are UUIDs, so the public URL's
 * folder is unguessable, as per-user output serving requires.
 */

const INDEX = "visual-library.json";
const DIR = "visual-library";
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_TAGS = 20;
const STOP = new Set(("a an the and of in on at to with for by from his her their its is are as into over under "
  + "shot cinematic film still motion 35mm anamorphic shallow depth field warm golden practical light against deep "
  + "shadow rich contrast gentle grain photorealistic slow deliberate camera movement every person shown black "
  + "african unless described otherwise no text captions logos").split(" "));

export const isClipId = (id) => typeof id === "string" && ID_RE.test(id);

export function clipDir(outputDir, id) {
  if (!isClipId(id)) throw new Error("invalid clip id");
  return path.join(outputDir, DIR, id);
}

const urlFor = (id, name) => `/outputs/${DIR}/${id}/${name}`;

export function readLibrary(dataDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dataDir, INDEX), "utf8"));
    return Array.isArray(parsed?.clips) ? parsed.clips : [];
  } catch {
    return [];
  }
}

function writeLibrary(dataDir, clips) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, INDEX);
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ clips }, null, 2));
  fs.renameSync(tmp, file);
}

const cleanTags = (tags) => [...new Set((Array.isArray(tags) ? tags : [])
  .map((t) => String(t).trim().toLowerCase().slice(0, 40)).filter(Boolean))].slice(0, MAX_TAGS);

/**
 * Move a downloaded clip into the library and record it.
 * @param {{ dataDir: string, outputDir: string }} ctx
 * @param {{ file: string, posterFile?: string|null, prompt?: string, lead?: string, model?: string, resolution?: string,
 *           aspect?: string, durationSec?: number, tokens?: number, costUsd?: number, taskId?: string, source?: object, tags?: string[] }} input
 */
export function addClip(ctx, input) {
  const id = crypto.randomUUID();
  const dir = clipDir(ctx.outputDir, id);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, "clip.mp4");
  fs.copyFileSync(input.file, target);
  fs.rmSync(input.file, { force: true });
  let poster = null;
  if (input.posterFile && fs.existsSync(input.posterFile)) {
    fs.copyFileSync(input.posterFile, path.join(dir, "poster.jpg"));
    fs.rmSync(input.posterFile, { force: true });
    poster = "poster.jpg";
  }
  const clip = {
    id,
    createdAt: Date.now(),
    prompt: String(input.prompt || ""),
    promptKnown: Boolean(input.prompt),
    lead: String(input.lead || ""),
    model: input.model || null,
    resolution: input.resolution || null,
    aspect: input.aspect || "portrait",
    durationSec: Number(input.durationSec) || null,
    tokens: Number(input.tokens) || null,
    costUsd: Number(input.costUsd) || 0,
    taskId: input.taskId || null,
    source: input.source || null,
    tags: cleanTags(input.tags),
    rating: null,
    url: urlFor(id, "clip.mp4"),
    posterUrl: poster ? urlFor(id, poster) : null,
  };
  writeLibrary(ctx.dataDir, [clip, ...readLibrary(ctx.dataDir)]);
  return clip;
}

export function getClip(dataDir, id) {
  return readLibrary(dataDir).find((c) => c.id === id) || null;
}

export function clipFile(ctx, clip) {
  const file = path.join(clipDir(ctx.outputDir, clip.id), "clip.mp4");
  return fs.existsSync(file) ? file : null;
}

export function updateClip(dataDir, id, patch) {
  let updated = null;
  const clips = readLibrary(dataDir).map((c) => {
    if (c.id !== id) return c;
    updated = {
      ...c,
      ...(patch.tags !== undefined ? { tags: cleanTags(patch.tags) } : {}),
      ...(patch.rating !== undefined ? { rating: [1, 2, 3, 4, 5].includes(patch.rating) ? patch.rating : null } : {}),
    };
    return updated;
  });
  if (updated) writeLibrary(dataDir, clips);
  return updated;
}

export function removeClip(ctx, id) {
  const clips = readLibrary(ctx.dataDir);
  if (!clips.some((c) => c.id === id)) return false;
  writeLibrary(ctx.dataDir, clips.filter((c) => c.id !== id));
  fs.rmSync(clipDir(ctx.outputDir, id), { recursive: true, force: true });
  return true;
}

export function promptWords(text) {
  return new Set(String(text || "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w)));
}

function similarity(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * Library clips for a search box: by words in the prompt and tags, newest
 * first among equals. aspect narrows to clips that fit the video's frame.
 */
export function searchClips(dataDir, { q = "", aspect = null, limit = 60 } = {}) {
  const want = promptWords(q);
  return readLibrary(dataDir)
    .filter((c) => !aspect || c.aspect === aspect)
    .map((c) => ({ c, score: want.size ? similarity(want, promptWords(`${c.prompt} ${c.tags.join(" ")}`)) : 0 }))
    .filter((x) => !want.size || x.score > 0)
    .sort((x, y) => y.score - x.score || y.c.createdAt - x.c.createdAt)
    .slice(0, limit)
    .map((x) => x.c);
}

/** Clips whose prompt is close to this one: offered before ordering a new clip. */
export function similarClips(dataDir, prompt, { aspect = null, threshold = 0.3, limit = 3 } = {}) {
  const want = promptWords(prompt);
  return readLibrary(dataDir)
    .filter((c) => c.promptKnown && (!aspect || c.aspect === aspect))
    .map((c) => ({ clip: c, score: similarity(want, promptWords(c.prompt)) }))
    .filter((x) => x.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
