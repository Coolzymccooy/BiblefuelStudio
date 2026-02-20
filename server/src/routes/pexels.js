import { Router } from "express";
import { pexelsSearchVideos, pexelsDownloadVideoById } from "../lib/pexels.js";
import { addToLibrary } from "../lib/library.js";
import { deriveOutputJpgPathFromVideo, generateVideoThumbnail, normalizePathSlashes, toOutputPublicPath } from "../lib/mediaThumb.js";

const router = Router();

router.get("/search", async (req, res) => {
  try {
    const rawKey = (process.env.PEXELS_API_KEY || "");
    const key = rawKey.replace(/['"]/g, '').trim();
    if (!key || key.startsWith("your-")) {
      return res.status(400).json({ ok: false, error: "PEXELS_API_KEY missing or invalid" });
    }
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ ok: false, error: "q required" });
    const videos = await pexelsSearchVideos(q, 24);
    res.json({ ok: true, videos });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

router.post("/download", async (req, res) => {
  try {
    const rawKey = (process.env.PEXELS_API_KEY || "");
    const key = rawKey.replace(/['"]/g, '').trim();
    if (!key || key.startsWith("your-")) {
      return res.status(400).json({ ok: false, error: "PEXELS_API_KEY missing or invalid" });
    }
    const id = String(req.body?.id || "").trim();
    if (!id) return res.status(400).json({ ok: false, error: "id required" });
    const file = await pexelsDownloadVideoById(id);

    const normalizedFile = normalizePathSlashes(file);
    const sourceImage = String(req.body?.image || "").trim() || undefined;
    const sourcePreviewUrl = String(req.body?.previewUrl || "").trim() || undefined;
    const sourceUrl = String(req.body?.url || "").trim() || undefined;
    const parsedDuration = Number(req.body?.duration);
    const duration = Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : 0;
    const previewUrl = toOutputPublicPath(normalizedFile);
    const thumb = generateVideoThumbnail(normalizedFile, { outputBaseName: `thumb-pexels-${id}` });
    const fallbackImage = deriveOutputJpgPathFromVideo(normalizedFile);

    const item = {
      id: `pexels_${id}`,
      provider: "pexels",
      sourceId: id,
      url: normalizedFile,
      previewUrl,
      image: sourceImage || thumb || fallbackImage || undefined,
      duration,
      sourceUrl,
      sourcePreviewUrl,
      downloadedAt: new Date().toISOString(),
    };
    const saved = addToLibrary(item);

    res.json({ ok: true, file: normalizedFile, item: saved });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
