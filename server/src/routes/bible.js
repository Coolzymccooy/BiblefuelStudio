/**
 * Bible API routes.
 *
 * GET  /api/bible/translations   list of supported translations + capability flags
 * GET  /api/bible/parse?reference=John+3:16              → parsed reference + YouVersion link
 * GET  /api/bible/verse?reference=John+3:16&translation=niv → fetched verses + link
 *
 * All routes require auth (mounted under `requireAuth` in server/index.js).
 */

import { Router } from "express";
import { normalizeReference } from "../lib/bible/bibleReference.js";
import {
  lookupVerses,
  listTranslations,
  isKnownTranslation,
  isApiBibleConfigured,
} from "../lib/bible/scriptureApi.js";
import {
  buildYouVersionUrl,
  listYouVersionTranslations,
  resolveYouVersionTranslation,
} from "../lib/bible/youversion.js";

const router = Router();

const MAX_REFERENCE_LENGTH = 80;

router.get("/translations", (req, res) => {
  res.json({
    ok: true,
    apiBibleConfigured: isApiBibleConfigured(),
    translations: listTranslations(),
    youversion: listYouVersionTranslations(),
  });
});

router.get("/parse", (req, res) => {
  const reference = String(req.query?.reference || "").slice(0, MAX_REFERENCE_LENGTH);
  if (!reference.trim()) {
    return res.status(400).json({ ok: false, error: "reference required" });
  }
  const parsed = normalizeReference(reference);
  if (!parsed) {
    return res.status(422).json({ ok: false, error: `Could not parse reference: ${reference}` });
  }
  const translationKey = String(req.query?.translation || "kjv").slice(0, 20);
  const ytv = resolveYouVersionTranslation(translationKey);
  res.json({
    ok: true,
    reference: {
      canonical: parsed.canonical,
      book: parsed.book.name,
      bookUsfm: parsed.book.usfm,
      chapter: parsed.chapter,
      verseFrom: parsed.verseFrom,
      verseTo: parsed.verseTo,
    },
    youversion: {
      translation: ytv.code,
      url: buildYouVersionUrl(parsed, translationKey),
    },
  });
});

router.get("/verse", async (req, res) => {
  try {
    const reference = String(req.query?.reference || "").slice(0, MAX_REFERENCE_LENGTH);
    if (!reference.trim()) {
      return res.status(400).json({ ok: false, error: "reference required" });
    }
    const requestedTranslation = String(req.query?.translation || "kjv").trim().toLowerCase().slice(0, 20);
    if (!isKnownTranslation(requestedTranslation)) {
      return res.status(422).json({ ok: false, error: `Unknown translation: ${requestedTranslation}` });
    }

    const result = await lookupVerses(reference, requestedTranslation);
    if (!result.ok || !result.verses.length) {
      return res.status(404).json({
        ok: false,
        error: `No verses found for ${reference} (${requestedTranslation})`,
        warning: result.warning,
      });
    }

    const parsed = normalizeReference(reference);
    const youversion = parsed
      ? {
          translation: resolveYouVersionTranslation(requestedTranslation).code,
          url: buildYouVersionUrl(parsed, requestedTranslation),
        }
      : null;

    res.json({
      ok: true,
      reference: result.canonical,
      translation: result.translation,
      requestedTranslation,
      verses: result.verses,
      source: result.source,
      warning: result.warning,
      youversion,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

export default router;
