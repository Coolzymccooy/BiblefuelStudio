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
import { buildSeriesPlan } from "../lib/series/seriesBuilder.js";
import { lookupVerses, isKnownTranslation } from "../lib/bible/scriptureApi.js";
import { enqueueCampaignAutoPost } from "./jobs.js";
import { appendSeries, listSeriesForUser } from "../lib/series/seriesStore.js";

const router = Router();

const PreviewSchema = z.object({
  reference: z.string().min(1).max(60),
  parts: z.number().int().min(2).max(12).optional().default(5),
  translation: z.string().min(2).max(8).optional().default("kjv"),
});

const GenerateSchema = PreviewSchema.extend({
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
  durationSec: z.number().int().min(8).max(60).optional().default(22),
  backgroundQuery: z.string().optional(),
  titlePrefix: z.string().max(60).optional(),
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

    const fetchVerses = makeVerseFetcher(input.translation);
    const plan = await buildSeriesPlan({
      chapterReference: input.reference,
      parts: input.parts,
      translation: input.translation,
      fetchVerses,
    });

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

    const fetchVerses = makeVerseFetcher(input.translation);
    const plan = await buildSeriesPlan({
      chapterReference: input.reference,
      parts: input.parts,
      translation: input.translation,
      fetchVerses,
    });

    /** @type {string[]} */
    const jobIds = [];
    for (const segment of plan.segments) {
      const verseText = segment.verses.map((v) => String(v.text || "").trim()).join(" ");
      const verseTextForTts = verseText.replace(/\s+/g, " ").slice(0, 1500);

      const prebuiltScript = {
        hook: `Part ${segment.partNumber} of ${segment.totalParts}`,
        verse: verseTextForTts,
        reference: segment.reference,
        reflection: "",
        cta: "Read more on YouVersion",
      };

      const title = input.titlePrefix
        ? `${input.titlePrefix} — Part ${segment.partNumber}/${segment.totalParts}`
        : `${plan.book} ${plan.chapter} — Part ${segment.partNumber}/${segment.totalParts}`;

      const job = await enqueueCampaignAutoPost({
        destination: input.destination,
        webhookId: input.webhookId,
        webhookUrl: input.webhookUrl,
        profileIds: input.profileIds,
        privacyStatus: input.privacyStatus,
        niche: input.niche,
        tone: input.tone,
        voiceId: input.voiceId,
        aspect: input.aspect,
        durationSec: input.durationSec,
        backgroundQuery: input.backgroundQuery,
        title,
        prebuiltScript,
        captionOverride: segment.caption,
        series: {
          seriesId: plan.seriesId,
          partNumber: segment.partNumber,
          totalParts: segment.totalParts,
          reference: segment.reference,
          chapterReference: plan.chapterReference,
        },
      });
      jobIds.push(job.id);
    }

    const record = appendSeries({
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

    res.json({ ok: true, series: record, plan, jobIds });
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err?.message || err) });
  }
});

router.get("/", (req, res) => {
  const userId = String(req.user?.sub || req.user?.id || "");
  const limit = Math.min(200, Math.max(1, Number(req.query?.limit || 50)));
  const series = listSeriesForUser(userId, limit);
  res.json({ ok: true, series });
});

export default router;
