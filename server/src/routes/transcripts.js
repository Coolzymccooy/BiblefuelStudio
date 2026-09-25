import { Router } from "express";
import { listTranscripts, upsertTranscript, deleteTranscript } from "../lib/transcriptStore.js";

const router = Router();

// GET /api/transcripts?limit=50 — list the caller's saved transcripts.
router.get("/", (req, res) => {
  try {
    const items = listTranscripts(req.ctx.dataDir, req.ctx.userId, Number(req.query?.limit) || 50);
    res.json({ ok: true, items });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// POST /api/transcripts — upsert a transcript by source file.
router.post("/", (req, res) => {
  try {
    const sourceFile = String(req.body?.sourceFile || "").trim();
    if (!sourceFile) return res.status(400).json({ ok: false, error: "sourceFile is required" });
    if (!Array.isArray(req.body?.words)) return res.status(400).json({ ok: false, error: "words[] is required" });
    if (!Array.isArray(req.body?.editedLines)) return res.status(400).json({ ok: false, error: "editedLines[] is required" });
    const item = upsertTranscript(req.ctx.dataDir, req.ctx.userId, {
      sourceFile,
      words: req.body.words,
      editedLines: req.body.editedLines,
      typographyPreset: req.body?.typographyPreset,
      durationSec: req.body?.durationSec,
    });
    res.json({ ok: true, item });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// DELETE /api/transcripts/:id — remove one of the caller's transcripts.
router.delete("/:id", (req, res) => {
  try {
    const removed = deleteTranscript(req.ctx.dataDir, req.ctx.userId, req.params.id);
    res.json({ ok: true, removed });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
