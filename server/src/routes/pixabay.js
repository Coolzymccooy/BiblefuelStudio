import { Router } from "express";
import { pixabaySearchVideos, pixabayDownloadVideoById } from "../lib/pixabay.js";

const router = Router();

router.get("/search", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ ok: false, error: "q required" });
    const videos = await pixabaySearchVideos(q, 24);
    res.json({ ok: true, videos });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

router.post("/download", async (req, res) => {
  try {
    const id = String(req.body?.id || "").trim();
    if (!id) return res.status(400).json({ ok: false, error: "id required" });
    const file = await pixabayDownloadVideoById(id);
    res.json({ ok: true, file });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
