import { Router } from "express";
import archiver from "archiver";
import fs from "fs";
import path from "path";
import { buildFreeLeadMagnet, buildPaidDevotional } from "../lib/gumroadPacks.js";

const router = Router();

let last = null;

router.post("/generate", async (req, res) => {
  try {
    const freeTitle = String(req.body?.freeTitle || "7 Bible Verses for Anxiety & Fear (With Reflections & Prayers)").trim();
    const paidTitle = String(req.body?.paidTitle || "Biblefuel: 30 Days of Strength, Peace & Faith").trim();
    const freeMarkdown = buildFreeLeadMagnet(freeTitle);
    const paidMarkdown = buildPaidDevotional(paidTitle);
    last = { freeTitle, paidTitle, freeMarkdown, paidMarkdown, createdAt: new Date().toISOString() };
    res.json({ ok:true, ...last });
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

export default router;
