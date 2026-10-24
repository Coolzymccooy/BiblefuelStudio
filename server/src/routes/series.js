/**
 * Series mode routes.
 *
 * POST /api/series/preview   build the plan without enqueueing (UI preview)
 * POST /api/series/generate  build + enqueue N campaign_auto_post jobs
 * GET  /api/series           list this user's series history
 *
 * Series turns one Bible chapter into a sequenced set of micro-videos —
 * each with verse text, on-screen captions, and a YouVersion deep-link.
 *
 * Job orchestration: each segment becomes one `campaign_auto_post` job
 * (existing pipeline) with a `prebuiltScript` payload that bypasses AI
 * script generation and uses authoritative verse text instead. Jobs run
 * sequentially via the existing single-worker queue.
 */

import { Router } from "express";
import { z } from "zod";
import { buildSeriesPlan, buildPartScript, charBudgetFor } from "../lib/series/seriesBuilder.js";
import { lookupVerses, isKnownTranslation } from "../lib/bible/scriptureApi.js";
import { enqueueCampaignAutoPost } from "./jobs.js";
import { appendSeries, listSeriesForUser } from "../lib/series/seriesStore.js";
import { generateBibleImage, isImageGenEnabled } from "../lib/imageGen/index.js";
import { consumeQuota } from "../middleware/quota.js";

const router = Router();

// Test seam: the verse lookup (network) and the job queue (starts the worker).
const REAL_DEPS = { fetchVerses: null, enqueue: enqueueCampaignAutoPost };
let deps = REAL_DEPS;
export function _setSeriesDepsForTests(overrides) {
  deps = overrides ? { ...REAL_DEPS, ...overrides } : REAL_DEPS;
}

// The longest video the renderer makes (jobs.js clamps every render to it).
// The plan never makes a part longer than this, so every verse in a part is
// read: a fixed 280-character cap used to drop the rest of the part silently.
function maxRenderSeconds() {
  const n = Number(process.env.MAX_RENDER_SECONDS || 30);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

/** @param {{ reference: string, versesPerPart: "auto" | "one" | number, durationSec: number, translation: string }} input */
function planFor(input) {
  return buildSeriesPlan({
    chapterReference: input.reference,
    versesPerPart: input.versesPerPart,
    durationSec: input.durationSec,
    maxRenderSeconds: maxRenderSeconds(),
    translation: input.translation,
    fetchVerses: deps.fetchVerses || makeVerseFetcher(input.translation),
  });
}

const PreviewSchema = z.object({
  reference: z.string().min(1).max(60),
  // "auto" fits whole sentences into the video length; a number is the
  // fewest verses per video; "one" is the whole passage in one video.
  versesPerPart: z.union([z.enum(["auto", "one"]), z.coerce.number().int().min(1).max(10)]).optional().default("auto"),
  // The video length. Auto splits the passage to fit it, so preview and
  // generate must both see it.
  durationSec: z.number().int().min(8).max(60).optional().default(22),
  translation: z.string().min(2).max(8).optional().default("kjv"),
});

export const GenerateSchema = PreviewSchema.extend({
  // Publish + render knobs (forwarded to campaign_auto_post).
  destination: z.enum(["webhook", "buffer", "youtube"]).optional().default("webhook"),
  webhookId: z.string().optional(),
  webhookUrl: z.string().url().optional(),
  profileIds: z.array(z.string()).optional(),
  privacyStatus: z.enum(["public", "unlisted", "private"]).optional().default("private"),
  niche: z.string().optional(),
  tone: z.string().optional(),
  voiceId: z.string().optional(),
  aspect: z.enum(["portrait", "square", "landscape"]).optional().default("portrait"),
  backgroundQuery: z.string().optional(),
  titlePrefix: z.string().max(60).optional(),
  // £0 generative artwork (Cloudflare Workers AI → Imagen failover). Off by
  // default so the render path stays identical to today unless the user opts
  // in. When true, one image per segment is generated up-front and spliced
  // in as the opening scene of that part's video.
  useGenImage: z.boolean().optional().default(false),
  // Kinetic-typography knobs. All three default to the scripture path inside
  // the route handler (see narrationCategory: input.narrationCategory ||
  // "scripture" below). Exposed here so power users can override per series
  // without needing a separate endpoint.
  narrationCategory: z.string().optional(),
  forcedAlignmentFallback: z.boolean().optional(),
  kineticCaptions: z.boolean().optional(),
  typographyPreset: z.string().optional(),
  captionEnergy: z.enum(["calm", "lively", "wild"]).optional(),
});

/**
 * Build a fetcher closure that lookupVerses can use, returning bare BibleVerse[].
 * Throws on lookup failure so the builder can surface a clean error.
 */
function makeVerseFetcher(translation) {
  return async (verseRange) => {
    const result = await lookupVerses(verseRange, translation);
    if (!result.ok || !result.verses.length) {
      throw new Error(`Verse fetch failed for ${verseRange}: ${result.warning || "no verses returned"}`);
    }
    return result.verses;
  };
}

router.post("/preview", async (req, res) => {
  try {
    const input = PreviewSchema.parse(req.body || {});
    if (!isKnownTranslation(input.translation)) {
      return res.status(422).json({ ok: false, error: `Unknown translation: ${input.translation}` });
    }

    const plan = await planFor(input);

    res.json({ ok: true, plan });
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err?.message || err) });
  }
});

router.post("/generate", async (req, res) => {
  try {
    const input = GenerateSchema.parse(req.body || {});
    if (!isKnownTranslation(input.translation)) {
      return res.status(422).json({ ok: false, error: `Unknown translation: ${input.translation}` });
    }

    const plan = await planFor(input);

    // Every part is one campaign_auto_post job, so one plan render. Spent before any image or job,
    // all or nothing: a series with more parts than the renders left starts nothing.
    // (This router is mounted without quota("render"), so a preview spends none.)
    const spent = consumeQuota(req.ctx, "render", plan.segments.length);
    if (!spent.ok) return res.status(spent.status).json(spent.body);

    // Image gen runs synchronously here (before enqueue) so a provider
    // failure surfaces to the user as a 400 rather than a half-broken series
    // of jobs. We only block on it when the user opted in AND we have at
    // least one configured provider.
    const wantImageGen = Boolean(input.useGenImage) && isImageGenEnabled();
    /** @type {Array<{ ok: boolean, publicUrl?: string, provider?: string, error?: string }>} */
    const imagesBySegment = [];
    if (wantImageGen) {
      for (const segment of plan.segments) {
        const img = await generateBibleImage({
          seriesId: plan.seriesId,
          partNumber: segment.partNumber,
          beatType: "verse",
          verseText: segment.verses?.[0]?.text || "",
          aspect: input.aspect,
        });
        if (!img.ok) {
          console.warn(`[SERIES] gen image failed for ${plan.seriesId} part ${segment.partNumber}: ${img.error}`);
        }
        imagesBySegment.push(img);
      }
    }

    /** @type {string[]} */
    const jobIds = [];
    for (let i = 0; i < plan.segments.length; i += 1) {
      const segment = plan.segments[i];
      // Every verse in the part is read: the plan already split the passage
      // so no part runs past the render limit. The cap here is only a guard
      // against a part longer than any video can be.
      const prebuiltScript = buildPartScript(segment, charBudgetFor(maxRenderSeconds()));

      const title = input.titlePrefix
        ? `${input.titlePrefix} — Part ${segment.partNumber}/${segment.totalParts}`
        : `${plan.book} ${plan.chapter} — Part ${segment.partNumber}/${segment.totalParts}`;

      const img = imagesBySegment[i];
      const generatedImage = img && img.ok && img.publicUrl ? img.publicUrl : null;

      const job = await deps.enqueue({
        destination: input.destination,
        webhookId: input.webhookId,
        webhookUrl: input.webhookUrl,
        profileIds: input.profileIds,
        privacyStatus: input.privacyStatus,
        niche: input.niche,
        tone: input.tone,
        voiceId: input.voiceId,
        aspect: input.aspect,
        // A part Auto lengthened to fit the series in 12 videos runs past the
        // length the user set; a still picture must last as long as its words.
        durationSec: Math.max(input.durationSec, segment.seconds),
        backgroundQuery: input.backgroundQuery,
        title,
        prebuiltScript,
        captionOverride: segment.caption,
        generatedImage,
        // Every series part IS scripture, so default to the scripture
        // narration category — that routes through an aligned TTS provider
        // and resolves the scripture-emphasis typography preset (gold
        // emphasised words, boxed verse backdrop). forcedAlignmentFallback
        // means Whisper transcribes the rendered audio for word
        // timestamps if the TTS provider doesn't return them, so series
        // videos never silently downgrade to the legacy 6-line renderer.
        // Caller can override any of these explicitly via the request body.
        narrationCategory: input.narrationCategory || "scripture",
        forcedAlignmentFallback: input.forcedAlignmentFallback !== false,
        kineticCaptions: input.kineticCaptions !== false,
        typographyPreset: input.typographyPreset || undefined,
        captionEnergy: input.captionEnergy || undefined,
        series: {
          seriesId: plan.seriesId,
          partNumber: segment.partNumber,
          totalParts: segment.totalParts,
          reference: segment.reference,
          chapterReference: plan.chapterReference,
        },
      }, {
        // Tenant isolation: stamp every series job with the caller's scope so
        // it (a) is owned by — and visible only to — its creator (+ super-admin)
        // and (b) renders into the creator's per-user data/output dirs. Omitting
        // this made series jobs global/null-owner: they surfaced under the
        // operator's Jobs list and rendered into the operator's directories.
        dataDir: req.ctx.dataDir,
        outputDir: req.ctx.outputDir,
        userId: req.ctx.userId,
        isSuperAdmin: Boolean(req.ctx.isSuperAdmin),
        isOwner: Boolean(req.ctx.isOwner),
      });
      jobIds.push(job.id);
    }

    const record = appendSeries(req.ctx.dataDir, {
      seriesId: plan.seriesId,
      userId: String(req.user?.sub || req.user?.id || "owner"),
      chapterReference: plan.chapterReference,
      book: plan.book,
      chapter: plan.chapter,
      translation: plan.translation,
      totalParts: plan.totalParts,
      jobIds,
      createdAt: new Date().toISOString(),
    });

    res.json({
      ok: true,
      series: record,
      plan,
      jobIds,
      imageGen: wantImageGen
        ? {
            requested: true,
            results: imagesBySegment.map((r, idx) => ({
              partNumber: idx + 1,
              ok: Boolean(r?.ok),
              provider: r?.provider,
              error: r?.ok ? undefined : r?.error,
            })),
          }
        : { requested: false },
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err?.message || err) });
  }
});

router.get("/", (req, res) => {
  const userId = String(req.user?.sub || req.user?.id || "");
  const limit = Math.min(200, Math.max(1, Number(req.query?.limit || 50)));
  const series = listSeriesForUser(req.ctx.dataDir, userId, limit);
  res.json({ ok: true, series });
});

export default router;
