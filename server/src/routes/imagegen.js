import { Router } from "express";
import { randomUUID } from "crypto";
import { generateBibleImage, isImageGenEnabled } from "../lib/imageGen/index.js";
import { selectBackgroundsForScript } from "../lib/autoBackground.js";
import { readUsage, incrementUsage } from "../lib/usageStore.js";
import { QUOTAS } from "../middleware/quota.js";

const MAX_VISUALS = 4;

let _generate = generateBibleImage;
let _enabled = isImageGenEnabled;
export function _setGenerateImpl(fn) { _generate = fn; }
export function _setEnabledImpl(fn) { _enabled = fn; }
export function _reset() { _generate = generateBibleImage; _enabled = isImageGenEnabled; }

const router = Router();

router.post("/generate", async (req, res) => {
  try {
    if (!_enabled()) {
      return res.status(503).json({ ok: false, error: "NOT_CONFIGURED" });
    }
    const lines = Array.isArray(req.body?.lines)
      ? req.body.lines.map((l) => String(l || "").trim()).filter(Boolean)
      : [];
    if (lines.length === 0) {
      return res.status(400).json({ ok: false, error: "lines[] is required (nothing to generate from)" });
    }
    const aspect = ["portrait", "landscape", "square"].includes(String(req.body?.aspect))
      ? String(req.body.aspect) : "portrait";
    let count = Math.max(1, Math.min(MAX_VISUALS, Math.floor(Number(req.body?.count) || 1)));

    const plan = req.ctx.plan;
    const limit = (QUOTAS[plan] || QUOTAS.free).imageGen;
    if (limit !== -1) {
      const { counts } = readUsage(req.ctx.dataDir);
      const remaining = Math.max(0, limit - Number(counts?.imageGen || 0));
      if (remaining === 0) {
        return res.status(429).json({ ok: false, error: "QUOTA_EXCEEDED", bucket: "imageGen", limit, plan });
      }
      count = Math.min(count, remaining);
    }

    const beats = selectBackgroundsForScript({ beats: lines, maxBackgrounds: count }).beats.slice(0, count);
    const seriesId = `genvis-${String(req.ctx.userId || "anon")}-${randomUUID().slice(0, 8)}`;

    const items = [];
    let failed = 0;
    for (let i = 0; i < beats.length; i++) {
      const r = await _generate({ seriesId, partNumber: i + 1, beatType: "verse", verseText: beats[i].text, aspect });
      if (r?.ok && r.path) {
        items.push({ id: r.path, publicUrl: r.publicUrl, kind: "image" });
        incrementUsage(req.ctx.dataDir, "imageGen");
      } else {
        failed += 1;
      }
    }

    if (items.length === 0) {
      return res.status(502).json({ ok: false, error: "GENERATION_FAILED", failed });
    }
    return res.json({ ok: true, items, generated: items.length, failed });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
