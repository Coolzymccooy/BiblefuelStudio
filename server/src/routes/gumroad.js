import { Router } from "express";
import archiver from "archiver";
import fs from "fs";
import path from "path";
import { buildFreeLeadMagnet, buildPaidDevotional } from "../lib/gumroadPacks.js";
import { upsertGumroadPack, listGumroadPacks, deleteGumroadPack } from "../lib/gumroadStore.js";

const router = Router();

let last = null;

router.post("/generate", async (req, res) => {
  try {
    const freeTitle = String(req.body?.freeTitle || "7 Bible Verses for Anxiety & Fear (With Reflections & Prayers)").trim();
    const paidTitle = String(req.body?.paidTitle || "Biblefuel: 30 Days of Strength, Peace & Faith").trim();
    const freeMarkdown = buildFreeLeadMagnet(freeTitle);
    const paidMarkdown = buildPaidDevotional(paidTitle);
    last = { freeTitle, paidTitle, freeMarkdown, paidMarkdown, createdAt: new Date().toISOString() };
    // Best-effort persist to per-user history; never block generation on a save error.
    let savedId = null;
    try {
      const rec = upsertGumroadPack(req.ctx.dataDir, req.ctx.userId, { freeTitle, paidTitle, freeMarkdown, paidMarkdown });
      savedId = rec.id;
    } catch (e) {
      console.warn("[gumroad] history save failed:", e?.message || e);
    }
    res.json({ ok: true, id: savedId, ...last });
  } catch (e) {
    res.status(400).json({ ok:false, error:String(e?.message||e) });
  }
});

router.get("/download.zip", async (req, res) => {
  try {
    if(!last){
      // generate defaults if none
      const freeTitle = "7 Bible Verses for Anxiety & Fear (With Reflections & Prayers)";
      const paidTitle = "Biblefuel: 30 Days of Strength, Peace & Faith";
      last = {
        freeTitle, paidTitle,
        freeMarkdown: buildFreeLeadMagnet(freeTitle),
        paidMarkdown: buildPaidDevotional(paidTitle),
        createdAt: new Date().toISOString()
      };
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", "attachment; filename=biblefuel-gumroad-pack.zip");

    const archive = archiver("zip", { zlib: { level: 9 }});
    archive.on("error", err => { throw err; });
    archive.pipe(res);

    archive.append(last.freeMarkdown, { name: "FREE-LEAD-MAGNET.md" });
    archive.append(last.paidMarkdown, { name: "PAID-30-DAY-DEVOTIONAL.md" });
    archive.append(
      `Created: ${last.createdAt}\n\nFree title: ${last.freeTitle}\nPaid title: ${last.paidTitle}\n`,
      { name: "README.txt" }
    );

    await archive.finalize();
  } catch (e) {
    res.status(400).json({ ok:false, error:String(e?.message||e) });
  }
});

// GET /api/gumroad/history?limit=50 — list the caller's saved packs.
router.get("/history", (req, res) => {
  try {
    const items = listGumroadPacks(req.ctx.dataDir, req.ctx.userId, Number(req.query?.limit) || 50);
    res.json({ ok: true, items });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

// DELETE /api/gumroad/history/:id — remove one of the caller's saved packs.
router.delete("/history/:id", (req, res) => {
  try {
    const removed = deleteGumroadPack(req.ctx.dataDir, req.ctx.userId, req.params.id);
    res.json({ ok: true, removed });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
