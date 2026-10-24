import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { ok, fail, withoutOk } from "../toolResult.js";
import { outputUrl } from "../jobs.js";
import { resolveMediaInput } from "../mediaPath.js";

const SOURCES = ["pexels", "pixabay"];
const LIBRARY_ACTIONS = ["list", "add", "remove", "categories", "download"];
const ASPECTS = ["portrait", "landscape", "square"];
const VIDEO_EXT = /\.(mp4|mov|webm|m4v)$/i;
const PROVIDER_ID = /^\d{1,12}$/;
// Library ids are word characters and hyphens (pexels_123, agent_<uuid>); anything else could change the route's path.
const ITEM_ID = /^[\w-]{1,200}$/;
const SEARCH_DEFAULT = 12;
const SEARCH_MAX = 24;
const LIST_DEFAULT = 50;
const LIST_MAX = 200;
const MAX_IMAGES = 4;

/** A copy of `fields` without undefined values, so the route's own defaults apply. */
function defined(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

// ---- backgrounds_search -----------------------------------------------------

/** Width and height of the largest file a search hit offers, or nulls. */
function largestSize(files) {
  const list = Array.isArray(files) ? files : [];
  const best = list.reduce((top, file) => ((file?.width || 0) > (top?.width || 0) ? file : top), null);
  return { width: best?.width ?? null, height: best?.height ?? null };
}

function searchItem(source, video) {
  return {
    id: String(video.id),
    libraryId: `${source}_${video.id}`,
    previewUrl: video.previewUrl ?? null,
    image: video.image ?? null,
    pageUrl: video.url ?? null,
    durationSec: video.duration ?? null,
    ...largestSize(video.files),
  };
}

const backgroundsSearch = {
  name: "backgrounds_search",
  title: "Search stock background videos",
  description:
    "Search free stock background VIDEOS on Pexels or Pixabay (there is no photo search). Returns items with id, previewUrl (a small playable clip on the provider's site), image (a still), pageUrl, durationSec, width and height, " +
    "and libraryId, the id the clip will have in your library once saved. Results are NOT in your library yet and render tools cannot use them: " +
    "save the ones you want with library_items action download (source and sourceId = the item's id), then pass the libraryId as the background. " +
    "The search is screened for a Christian content library, so unrelated religious searches are refused. Needs the provider's key on this server (an error names it if missing). Free; takes a second or two. " +
    "limit is 1 to 24 (default 12).",
  inputSchema: {
    source: z.enum(SOURCES).describe("pexels or pixabay."),
    query: z.string().trim().min(1).max(100).describe("What to look for, for example sunrise over hills."),
    limit: z.number().int().min(1).max(SEARCH_MAX).optional().describe("How many results to return, 1 to 24. Default 12."),
  },
  routes: ["/api/pexels", "/api/pixabay"],
  async handler(ctx, { source, query, limit }) {
    const body = await ctx.api.call("GET", `/api/${source}/search`, { query: { q: query } });
    const videos = Array.isArray(body?.videos) ? body.videos : [];
    const items = videos.slice(0, limit ?? SEARCH_DEFAULT).map((video) => searchItem(source, video));
    return ok({ source, query, count: items.length, items });
  },
};

// ---- library_items ----------------------------------------------------------

/** A library item as the agent sees it: playable urls, no server file paths. */
function publicItem(item, base) {
  return {
    id: String(item.id),
    provider: item.provider ?? null,
    title: item.title ?? null,
    previewUrl: outputUrl(item.previewUrl || item.cloudUrl, base) || null,
    image: outputUrl(item.image || item.cloudImage, base) || null,
    durationSec: item.duration ?? null,
    categories: Array.isArray(item.categories) ? item.categories : [],
    searchQuery: item.searchQuery ?? null,
    savedAt: item.savedAt ?? null,
  };
}

async function listItems(ctx, { category, limit }) {
  const body = await ctx.api.call("GET", "/api/library");
  const all = Array.isArray(body?.library?.items) ? body.library.items : [];
  const wanted = category?.trim().toLowerCase();
  const matching = wanted ? all.filter((item) => Array.isArray(item.categories) && item.categories.includes(wanted)) : all;
  const items = matching.slice(0, limit ?? LIST_DEFAULT).map((item) => publicItem(item, ctx.publicBase));
  return ok({ items, total: matching.length });
}

async function addItem(ctx, { mediaPath, title, categories, durationSec }) {
  if (!mediaPath) return fail("BAD_INPUT", "add needs mediaPath, a video in your media folder.");
  const checked = await resolveMediaInput(ctx, mediaPath);
  if (checked.refusal) return checked.refusal;
  if (!VIDEO_EXT.test(checked.path)) return fail("BAD_INPUT", "add takes a video file: mp4, mov, webm or m4v.");
  const id = `agent_${randomUUID()}`;
  await ctx.api.call("POST", "/api/library/add", { body: defined({ id, url: checked.path, title, duration: durationSec }) });
  const added = { id, added: true, file: path.basename(checked.path) };
  if (!categories?.length) return ok(added);
  return ok({ ...added, categoriesApplied: await applyCategories(ctx, id, categories) });
}

/** Tags an item that was just created; a failure leaves the item in place and reports false. */
async function applyCategories(ctx, id, categories) {
  try {
    await ctx.api.call("PATCH", `/api/library/${encodeURIComponent(id)}/categories`, { body: { categories } });
    return true;
  } catch (err) {
    if (err?.name === "ApiError") return false;
    throw err;
  }
}

async function removeItem(ctx, { id }) {
  if (!id) return fail("BAD_INPUT", "remove needs the library item id.");
  await ctx.api.call("DELETE", `/api/library/${encodeURIComponent(id)}`);
  return ok({ removed: id });
}

async function listCategories(ctx) {
  const body = await ctx.api.call("GET", "/api/library/categories");
  return ok({ categories: Array.isArray(body?.categories) ? body.categories : [] });
}

async function downloadItem(ctx, { source, sourceId, query, durationSec }) {
  if (!source || !sourceId) return fail("BAD_INPUT", "download needs source (pexels or pixabay) and sourceId (the id from backgrounds_search).");
  if (!PROVIDER_ID.test(sourceId)) return fail("BAD_INPUT", "sourceId must be the numeric id from backgrounds_search.");
  const refused = await ctx.chargeCap("imports", 1);
  if (refused) return refused;
  const body = await ctx.api.call("POST", `/api/${source}/download`, {
    body: defined({ id: sourceId, searchQuery: query, duration: durationSec }),
  });
  return ok({ item: publicItem(withoutOk(body).item || {}, ctx.publicBase) });
}

const LIBRARY_HANDLERS = { list: listItems, add: addItem, remove: removeItem, categories: listCategories, download: downloadItem };

const libraryItems = {
  name: "library_items",
  title: "Your background library",
  description:
    "Your saved background videos. A library id (the id of an item here, for example pexels_123) is accepted as a background by the render tools, so this is where backgrounds come from. " +
    "action list: items with id, previewUrl, image, durationSec and categories; filter with category, limit is 1 to 200 (default 50). " +
    "action categories: the category names you can tag with. " +
    "action download: save a backgrounds_search result (source and sourceId; query tags it by mood, durationSec is optional); the clip is stored on the server and counts against the daily imports cap (one per call); takes a few seconds, returns the item whose id you pass as a background. " +
    "action add: put a video from your media folder (mediaPath from media_list or media_import_url) in the library, with optional title, categories and durationSec; returns its new id. " +
    "action remove: delete the item with that id from the library (the video file is kept; removing an id that is not there still succeeds). Free.",
  inputSchema: {
    action: z.enum(LIBRARY_ACTIONS).describe("list, add, remove, categories or download."),
    id: z.string().regex(ITEM_ID, "id must be letters, digits, _ and - only").optional().describe("remove: the library item id."),
    category: z.string().max(40).optional().describe("list: only items tagged with this category."),
    limit: z.number().int().min(1).max(LIST_MAX).optional().describe("list: how many to return, 1 to 200."),
    source: z.enum(SOURCES).optional().describe("download: pexels or pixabay."),
    sourceId: z.string().max(20).optional().describe("download: the item id from backgrounds_search (digits)."),
    query: z.string().max(100).optional().describe("download: the search words, used to tag the clip by mood."),
    mediaPath: z.string().max(1000).optional().describe("add: a video in your media folder (mp4, mov, webm or m4v). URLs are refused."),
    title: z.string().max(100).optional().describe("add: a name for the item."),
    categories: z.array(z.string().max(40)).max(10).optional().describe("add: tags, ideally names from action categories (lower-cased, at most 12 kept)."),
    durationSec: z.number().min(0).max(36000).optional().describe("add or download: the clip length in seconds, if you know it."),
  },
  routes: ["/api/library", "/api/pexels", "/api/pixabay"],
  async handler(ctx, input) {
    return LIBRARY_HANDLERS[input.action](ctx, input);
  },
};

// ---- images_generate --------------------------------------------------------

const imagesGenerate = {
  name: "images_generate",
  title: "Generate background images",
  description:
    "Generate AI still images for a video from text lines (for example the lines of a verse); each image is made from one line. Returns images, each with path (pass it to the tools that take an image) and url (viewable), plus generated and failed counts. " +
    "Needs an image provider on this server (NOT_CONFIGURED otherwise). A plan's daily image quota can lower the count; QUOTA_EXCEEDED when it is used up. " +
    "Each image spends one of the agent's daily images and one of the plan's imageGen quota, and the paid Gemini provider may charge the operator about $0.04 a picture. Takes roughly 5 to 30 seconds per image. " +
    "count is 1 to 4 (default 1); aspect is portrait (default), landscape or square.",
  inputSchema: {
    lines: z.array(z.string().trim().min(1).max(500)).min(1).max(10).describe("The text to illustrate, one line per image idea. 1 to 10 lines."),
    aspect: z.enum(ASPECTS).optional().describe("portrait (default), landscape or square."),
    count: z.number().int().min(1).max(MAX_IMAGES).optional().describe("How many images, 1 to 4. Default 1."),
  },
  routes: ["/api/imagegen"],
  caps: { images: (input) => input?.count ?? 1 },
  async handler(ctx, { lines, aspect, count }) {
    const body = await ctx.api.call("POST", "/api/imagegen/generate", { body: defined({ lines, aspect, count }) });
    const items = Array.isArray(body?.items) ? body.items : [];
    const images = items.map((item) => ({ path: item.publicUrl, url: outputUrl(item.publicUrl, ctx.publicBase) }));
    return ok({ images, generated: body?.generated ?? images.length, failed: body?.failed ?? 0 });
  },
};

export default [backgroundsSearch, libraryItems, imagesGenerate];
