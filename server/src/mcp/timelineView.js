import { z } from "zod";
import { fail } from "./toolResult.js";
import { resolveMediaInput } from "./mediaPath.js";

/**
 * Shared pieces of the Timeline tools (tools/timeline.js): the project's shape
 * as the routes and the client build it (client/src/lib/timelineProject.ts),
 * the asset path rule, and what a render will synthesise. Lives outside tools/
 * because the registry loads every file there as tools.
 */

// routes/timeline.js safeProjectId keeps [a-z0-9_-] only: anything else would save under another id.
export const TIMELINE_ID = z.string().trim().regex(/^[A-Za-z0-9_-]{1,120}$/, "a timeline project id");
export const TIMELINE_QUALITIES = ["proof_720p", "standard_1080p", "final_1080p"];
const TRACK_KINDS = ["video", "broll", "voiceover", "music", "captions", "effects"];
const ASSET_KINDS = ["video", "audio", "image", "caption", "effect"];
const VOICE_SOURCES = new Set(["chatterbox", "fish"]);
const PATH_FIELDS = ["path", "proxyPath"];
const MUSIC_REF = /^(?:library|mylib):[\w.-]+$/;

const assetSchema = z.object({
  id: z.string().max(120).optional(),
  kind: z.enum(ASSET_KINDS).describe("video, audio, image, caption or effect."),
  source: z.string().max(40).optional().describe("upload, library, imagegen, chatterbox, fish, system..."),
  label: z.string().max(200).optional(),
  path: z.string().max(1000).optional().describe("A file in your media folder, or a library:/mylib: music ref."),
  proxyPath: z.string().max(1000).optional(),
  durationSec: z.number().min(0).optional(),
  prompt: z.string().max(5000).optional().describe("A voiceover's words, for a chatterbox or fish asset without a path."),
}).passthrough();

const clipSchema = z.object({
  id: z.string().max(120),
  assetId: z.string().max(120),
  startSec: z.number().min(0),
  durationSec: z.number().min(0),
  text: z.string().max(2000).optional().describe("A caption clip's words."),
}).passthrough();

const trackSchema = z.object({
  id: z.string().max(120),
  kind: z.enum(TRACK_KINDS),
  label: z.string().max(200).optional(),
  clips: z.array(clipSchema).max(1000),
  hidden: z.boolean().optional(),
}).passthrough();

export const PROJECT_SCHEMA = z.object({
  id: TIMELINE_ID,
  title: z.string().trim().min(1).max(200),
  aspect: z.enum(["16:9", "9:16", "1:1"]).optional(),
  assets: z.record(z.string().max(120), assetSchema),
  tracks: z.array(trackSchema).max(40),
  scenes: z.array(z.object({}).passthrough()).max(200).optional(),
  renderSettings: z.object({ quality: z.enum(TIMELINE_QUALITIES).optional() }).passthrough().optional(),
}).passthrough();

const listOf = (value) => (Array.isArray(value) ? value : []);

/** A row of timeline_project list: what the project is and how big, without its assets. */
export function summaryView(project) {
  const tracks = listOf(project.tracks);
  return {
    id: project.id,
    title: project.title ?? "",
    aspect: project.aspect ?? null,
    template: project.template ?? null,
    targetDurationSec: project.targetDurationSec ?? null,
    updatedAt: project.updatedAt ?? null,
    tracks: tracks.length,
    clips: tracks.reduce((sum, t) => sum + listOf(t.clips).length, 0),
    assets: Object.keys(project.assets || {}).length,
  };
}

/** One asset path the agent may use: a music ref as given, else a file confined to the media folder. */
async function confinedValue(ctx, value) {
  if (MUSIC_REF.test(value.trim())) return { path: value.trim() };
  return resolveMediaInput(ctx, value);
}

function assetRefusal(id, asset, refusal) {
  const { error, message } = refusal.structuredContent;
  const name = asset.label ? `"${asset.label}" (${id})` : id;
  return fail(error, `Asset ${name}: ${message} URLs and library item ids are not accepted here: bring the file in with media_import_url or library_items download, then use the path it returns.`);
}

/**
 * Every asset's path and proxyPath checked by the media path rule. Returns the
 * project with each one replaced by the real path the route should read, or the
 * refusal naming the first asset that is not the user's.
 */
export async function confineAssets(ctx, project) {
  const assets = {};
  for (const [id, asset] of Object.entries(project.assets || {})) {
    let next = asset;
    for (const field of PATH_FIELDS) {
      const value = asset?.[field];
      if (typeof value !== "string" || !value.trim()) continue;
      const checked = await confinedValue(ctx, value);
      if (checked.refusal) return { refusal: assetRefusal(id, asset, checked.refusal) };
      next = { ...next, [field]: checked.path };
    }
    assets[id] = next;
  }
  return { project: { ...project, assets } };
}

const isVoicePlaceholder = (asset) =>
  asset?.kind === "audio" && VOICE_SOURCES.has(asset.source) && !asset.path && Boolean(asset.prompt);

/** How many voiceover clips the render will synthesise (the renderer voices each placeholder clip on a visible voiceover lane). */
export function voicePlaceholderCount(project) {
  const assets = project.assets || {};
  return listOf(project.tracks)
    .filter((t) => t?.kind === "voiceover" && t.hidden !== true)
    .flatMap((t) => listOf(t.clips))
    .filter((clip) => Number(clip?.durationSec) > 0 && isVoicePlaceholder(assets[clip.assetId]))
    .length;
}
