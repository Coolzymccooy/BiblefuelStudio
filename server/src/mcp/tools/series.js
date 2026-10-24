import { z } from "zod";
import { ok, fail } from "../toolResult.js";
import { renderQuotaRefusal } from "../planQuota.js";
import { VOICE_ID_PATTERN } from "./voice.js";
import { webhookRefusal } from "./publish.js";
import { CAP_ENV_NAMES } from "../../lib/agentKeys/capEnv.js";

// Series: one Bible passage cut into a numbered set of short videos. Each part
// is one campaign_auto_post job: rendered and posted to the destination, so
// series_generate needs the key's publish consent and charges a render and a
// publish per part. No tool takes a URL the server would post to: a webhook is
// a saved id (R27).

const DESTINATIONS = ["webhook", "buffer", "youtube"];
const PRIVACY = ["public", "unlisted", "private"];
const ASPECTS = ["portrait", "square", "landscape"];
const SAVED_ID = /^[\w-]{1,100}$/;
const STYLE_WORD = /^[\w-]{1,40}$/;
const GENERATE_FIELDS = [
  "reference", "versesPerPart", "durationSec", "translation", "destination", "webhookId", "profileIds", "privacyStatus",
  "niche", "tone", "voiceId", "aspect", "backgroundQuery", "titlePrefix", "useGenImage", "narrationCategory",
  "kineticCaptions", "typographyPreset", "captionEnergy",
];
const PLAN_FIELDS = ["reference", "versesPerPart", "durationSec", "translation"];

const pick = (source, fields) => Object.fromEntries(fields.filter((f) => source?.[f] !== undefined).map((f) => [f, source[f]]));

// routes/series.js PreviewSchema.
const planSchema = {
  reference: z.string().trim().min(1).max(60).describe("A Bible passage, for example John 3 or Psalm 23:1-6."),
  versesPerPart: z.union([z.enum(["auto", "one"]), z.number().int().min(1).max(10)]).optional()
    .describe("auto (default) fits whole sentences into each video; a number is the fewest verses per video; one puts the whole passage in one video."),
  durationSec: z.number().int().min(8).max(60).optional().describe("Each video's length in seconds (default 22); auto splits the passage to fit it."),
  translation: z.string().trim().min(2).max(8).optional().describe("The Bible translation, for example kjv (default) or web."),
};

// ---- series_project ----------------------------------------------------------

const seriesProject = {
  name: "series_project",
  title: "Bible series: history and preview",
  description:
    "Series turn one Bible passage into a numbered set of short videos (Part 1/5, 2/5, ...), each with the verses read aloud, captions and a YouVersion link. " +
    "action list { limit? }: the series you made, newest first, with their job ids. preview { reference, versesPerPart?, durationSec?, translation? }: the plan (how many parts, which verses each, how long) without making anything. " +
    "Always preview first: series_generate makes and posts one video per part and costs per part. Free: no daily cap or plan quota.",
  inputSchema: {
    action: z.enum(["list", "preview"]).describe("list or preview."),
    limit: z.number().int().min(1).max(200).optional().describe("list: how many series (default 50)."),
    ...Object.fromEntries(Object.entries(planSchema).map(([k, v]) => [k, v.optional()])),
  },
  routes: ["/api/series"],
  async handler(ctx, input) {
    if (input.action === "list") {
      const body = await ctx.api.call("GET", "/api/series", input.limit ? { query: { limit: input.limit } } : undefined);
      return ok({ series: body?.series || [] });
    }
    if (!input.reference) return fail("BAD_INPUT", "series_project preview needs reference (a Bible passage).");
    const body = await ctx.api.call("POST", "/api/series/preview", { body: pick(input, PLAN_FIELDS) });
    return ok({ plan: body?.plan ?? null });
  },
};

// ---- series_generate ---------------------------------------------------------

const PER_PART_BUCKETS = new Set(["renders", "publishes"]);

/**
 * R51: a series longer than the renders or publishes left today gets a refusal that says why and
 * what to do, keeping the cap error's fields; any other refusal is returned as it is.
 */
function tooLongRefusal(refused, parts) {
  const details = refused?.structuredContent || {};
  if (details.error !== "MCP_CAP_REACHED" || !PER_PART_BUCKETS.has(details.bucket)) return refused;
  const left = Math.max(0, Number(details.limit) - Number(details.used));
  const keyNote = details.scope === "key" ? " The key's owner may also have set a lower daily limit for this key in Settings, Connected agents." : "";
  const message = `${parts} parts need ${parts} renders and ${parts} publishes; ${left} ${details.bucket} are left today. ` +
    `Make fewer parts, or raise ${CAP_ENV_NAMES.renders} / ${CAP_ENV_NAMES.publishes}.${keyNote}`;
  const { error: _code, message: _generic, ...fields } = details;
  return fail("MCP_CAP_REACHED", message, { ...fields, needed: parts });
}

const queuedJob = (id) => ({ kind: "job", id: String(id), status: "queued", percent: null, phase: null, output: null, error: null });

/** Charges what the route was expected to start but did not (fewer parts, no pictures made). */
async function refundUnstarted(ctx, charged, response) {
  const started = Array.isArray(response?.jobIds) ? response.jobIds.length : 0;
  const missing = Math.max(0, charged.renders - started);
  const refund = {
    ...(missing > 0 ? { renders: missing, publishes: missing } : {}),
    ...(charged.images > 0 && response?.imageGen?.requested !== true ? { images: charged.images } : {}),
  };
  if (Object.keys(refund).length) await ctx.refundCap(refund);
}

async function generate(ctx, input) {
  const destination = input.destination ?? "webhook";
  const badHook = destination === "webhook" ? await webhookRefusal(ctx, input.webhookId) : null;
  if (badHook) return badHook;
  const preview = await ctx.api.call("POST", "/api/series/preview", { body: pick(input, PLAN_FIELDS) });
  const parts = Array.isArray(preview?.plan?.segments) ? preview.plan.segments.length : 0;
  if (parts === 0) return fail("NO_PARTS", "That passage gives no parts. Check the reference with series_project preview.");
  // The route spends one plan render per part, all or nothing; read it first so a refused series spends no caps.
  const outOfQuota = await renderQuotaRefusal(ctx, parts);
  if (outOfQuota) return outOfQuota;
  const charge = { renders: parts, publishes: parts, ...(input.useGenImage ? { images: parts } : {}) };
  const refused = await ctx.chargeCap(charge);
  if (refused) return tooLongRefusal(refused, parts);
  const response = await ctx.api.call("POST", "/api/series/generate", { body: pick(input, GENERATE_FIELDS) });
  await refundUnstarted(ctx, charge, response);
  const jobIds = Array.isArray(response?.jobIds) ? response.jobIds : [];
  return ok({
    seriesId: response?.series?.seriesId ?? response?.plan?.seriesId ?? null,
    parts: jobIds.length,
    jobs: jobIds.map(queuedJob),
    plan: response?.plan ?? null,
    imageGen: response?.imageGen ?? null,
    charged: charge,
  });
}

const seriesGenerate = {
  name: "series_generate",
  title: "Make and post a Bible series",
  description:
    "Make every part of a series (see series_project preview) and post each finished video to destination: webhook (default; a saved webhook id from social_status, or the user's first enabled one), buffer or youtube. Needs the key's publish switch. " +
    "Each part is queued as its own job and runs one after another, a few minutes each. Returns one handle of kind job per part: call jobs_wait with kind job and each id. " +
    "Costs, per part, charged together before anything starts: one daily render, one daily publish and one unit of the plan's render quota (QUOTA_EXCEEDED, uncharged, when fewer renders are left than parts). " +
    "useGenImage also makes one AI picture per part (one daily images per part, given back if the server makes none). The daily publishes cap is small (3 by default), so a long series may need fewer parts or the cap raised. " +
    "If nothing is connected to post to, the videos are still made and each job says it was not shared.",
  inputSchema: {
    ...planSchema,
    destination: z.enum(DESTINATIONS).optional().describe("webhook (default), buffer or youtube."),
    webhookId: z.string().regex(SAVED_ID).optional().describe("webhook: a saved, enabled webhook id from social_status."),
    profileIds: z.array(z.string().regex(SAVED_ID)).max(10).optional().describe("buffer: Buffer profile ids from social_status."),
    privacyStatus: z.enum(PRIVACY).optional().describe("youtube: private (default), unlisted or public."),
    niche: z.string().max(200).optional().describe("The subject, for the post text."),
    tone: z.string().max(200).optional().describe("The voice of the post text."),
    voiceId: z.string().max(100).regex(VOICE_ID_PATTERN).optional().describe("A voice from voice_list."),
    aspect: z.enum(ASPECTS).optional().describe("portrait (default), square or landscape."),
    backgroundQuery: z.string().max(100).optional().describe("The mood to pick backgrounds by."),
    titlePrefix: z.string().max(60).optional().describe("Post titles become '<prefix> — Part n/N' (default: the book and chapter)."),
    useGenImage: z.boolean().optional().describe("true: open each part with an AI picture of its verse (costs daily images)."),
    narrationCategory: z.string().regex(STYLE_WORD).optional().describe("A voice profile from voice_list (default scripture)."),
    kineticCaptions: z.boolean().optional().describe("Word-by-word captions (default on)."),
    typographyPreset: z.string().regex(STYLE_WORD).optional().describe("A caption style name."),
    captionEnergy: z.enum(["calm", "lively", "wild"]).optional().describe("How much the captions move."),
  },
  routes: ["/api/series"],
  publish: true,
  handler: generate,
};

export default [seriesProject, seriesGenerate];
