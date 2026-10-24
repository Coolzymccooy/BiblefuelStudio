import { z } from "zod";
import { ok, fail, withoutOk } from "../toolResult.js";
import { outputUrl } from "../jobs.js";
import { resolveMediaInput } from "../mediaPath.js";

const ACTIONS = ["list", "similar", "import", "update", "remove"];
const ASPECTS = ["portrait", "landscape", "square"];
const LIST_MAX = 200;

/** A copy of `fields` without undefined values, so the route's own defaults apply. */
function defined(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

/** A clip with its url and poster as full, playable addresses. */
function publicClip(clip, base) {
  return {
    ...clip,
    url: outputUrl(clip?.url, base) || null,
    posterUrl: outputUrl(clip?.posterUrl, base) || null,
  };
}

async function listClips(ctx, { q, aspect, lead, tag, minRating, limit }) {
  const query = defined({ q, aspect, lead, tag, rating: minRating, limit });
  const body = await ctx.api.call("GET", "/api/visual-library", { query });
  const clips = Array.isArray(body?.clips) ? body.clips : [];
  return ok({ clips: clips.map((clip) => publicClip(clip, ctx.publicBase)), total: body?.total ?? clips.length });
}

async function similarClips(ctx, { prompt, aspect }) {
  if (!prompt) return fail("BAD_INPUT", "similar needs the prompt you are about to order a clip for.");
  const body = await ctx.api.call("GET", "/api/visual-library/similar", { query: defined({ prompt, aspect }) });
  const matches = Array.isArray(body?.matches) ? body.matches : [];
  return ok({ matches: matches.map(({ clip, score }) => ({ clip: publicClip(clip, ctx.publicBase), score })) });
}

async function importClip(ctx, { uploadPath, prompt, tags, costUsd, model, taskId }) {
  if (!uploadPath) return fail("BAD_INPUT", "import needs uploadPath, a background clip in your media folder.");
  const checked = await resolveMediaInput(ctx, uploadPath);
  if (checked.refusal) return checked.refusal;
  const body = defined({ uploadPath: checked.path, prompt, tags, costUsd, model, taskId });
  const result = await ctx.api.call("POST", "/api/visual-library/import", { body });
  return ok({ clip: publicClip(result?.clip, ctx.publicBase) });
}

async function updateClip(ctx, { id, tags, rating }) {
  if (!id) return fail("BAD_INPUT", "update needs the clip id.");
  if (tags === undefined && rating === undefined) return fail("BAD_INPUT", "update needs tags, rating or both.");
  const result = await ctx.api.call("PATCH", `/api/visual-library/${encodeURIComponent(id)}`, { body: defined({ tags, rating }) });
  return ok({ clip: publicClip(withoutOk(result).clip, ctx.publicBase) });
}

async function removeClip(ctx, { id, force }) {
  if (!id) return fail("BAD_INPUT", "remove needs the clip id.");
  try {
    await ctx.api.call("DELETE", `/api/visual-library/${encodeURIComponent(id)}`, force ? { query: { force: 1 } } : {});
  } catch (err) {
    if (err?.name === "ApiError" && err.status === 409) {
      return fail("IN_USE", `${err.message} Pass force true to remove it anyway.`);
    }
    throw err;
  }
  return ok({ removed: id });
}

const HANDLERS = { list: listClips, similar: similarClips, import: importClip, update: updateClip, remove: removeClip };

const visualLibrary = {
  name: "visual_library",
  title: "Library of paid AI clips",
  description:
    "Super-admin only: other keys do not see this tool. The library of paid AI video clips that can be reused across videos instead of ordering a new one. " +
    "action list: clips (id, prompt, aspect, durationSec, costUsd, tags, rating, url, posterUrl) with total; filter with q (words in the prompt), aspect, lead, tag, minRating (1 to 5); limit is 1 to 200 (default 60). " +
    "action similar: clips whose prompt is close to prompt, with a score; check this before paying for a new clip. " +
    "action update: set tags and/or rating (1 to 5) on the clip with that id. " +
    "action remove: delete a clip and its file; if a video uses it you get IN_USE, and force true removes it anyway. " +
    "action import: add a clip made elsewhere; uploadPath must be a background clip upload in your media folder (named bg-video-<uuid>.mp4, such as an AI clip a Story animate step wrote), otherwise 404; optional prompt, tags, costUsd, model, taskId. " +
    "Re-rolling a clip spends money and is not available here. Free and instant, except import, which checks and may convert the video (up to about a minute).",
  inputSchema: {
    action: z.enum(ACTIONS).describe("list, similar, import, update or remove."),
    id: z.string().max(100).optional().describe("update, remove: the clip id."),
    q: z.string().max(200).optional().describe("list: words to find in the prompt."),
    aspect: z.enum(ASPECTS).optional().describe("list, similar: portrait, landscape or square."),
    lead: z.string().max(600).optional().describe("list: only clips that show this lead subject."),
    tag: z.string().max(40).optional().describe("list: only clips with this tag."),
    minRating: z.number().int().min(1).max(5).optional().describe("list: only clips rated at least this."),
    limit: z.number().int().min(1).max(LIST_MAX).optional().describe("list: how many to return, 1 to 200."),
    prompt: z.string().max(1500).optional().describe("similar: the prompt to match. import: the prompt that made the clip."),
    uploadPath: z.string().max(1000).optional().describe("import: the clip in your media folder. URLs are refused."),
    tags: z.array(z.string().max(40)).max(20).optional().describe("update, import: tags, up to 20."),
    rating: z.number().int().min(1).max(5).optional().describe("update: a rating from 1 to 5."),
    costUsd: z.number().min(0).max(100).optional().describe("import: what the clip cost, in dollars."),
    model: z.string().max(80).optional().describe("import: the model that made the clip."),
    taskId: z.string().max(120).optional().describe("import: the provider's task id."),
    force: z.boolean().optional().describe("remove: delete even if a video uses the clip."),
  },
  routes: ["/api/visual-library"],
  requires: "super_admin",
  async handler(ctx, input) {
    return HANDLERS[input.action](ctx, input);
  },
};

export default [visualLibrary];
