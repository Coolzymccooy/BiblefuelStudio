import { Router } from "express";
import { pexelsSearchVideos, pexelsDownloadVideoById } from "../lib/pexels.js";

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
    res.json({ ok: true, file });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
