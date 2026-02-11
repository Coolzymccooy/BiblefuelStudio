import { Router } from "express";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { readLibrary, addToLibrary, removeFromLibrary } from "../lib/library.js";

const router = Router();

router.get("/", (req, res) => {
    res.json({ ok: true, library: readLibrary() });
});

router.post("/add", (req, res) => {
    const item = req.body || {};
    if (!item.id) return res.status(400).json({ ok: false, error: "id required" });
    addToLibrary(item);
    res.json({ ok: true });
});

router.delete("/:id", (req, res) => {
    removeFromLibrary(req.params.id);
    res.json({ ok: true });
});

router.post("/import-local", (req, res) => {
    try {
        const folderPath = String(req.body?.folderPath || "").trim();
        if (!folderPath) return res.status(400).json({ ok: false, error: "folderPath required" });
        if (!fs.existsSync(folderPath)) return res.status(400).json({ ok: false, error: "folderPath not found" });

        const exts = [".mp4", ".mov", ".webm", ".m4v"];
        const files = fs.readdirSync(folderPath)
            .filter(f => exts.includes(path.extname(f).toLowerCase()))
            .map(f => path.join(folderPath, f));

        const outDir = process.env.OUTPUT_DIR || "./outputs";
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

        const imported = [];
        for (const filePath of files) {
            const id = `local_${uuid()}`;
            const ext = path.extname(filePath) || ".mp4";
            const outFile = path.join(outDir, `local-${id}${ext}`);
            fs.copyFileSync(filePath, outFile);
            const item = {
                id,
                url: outFile.replace(/\\/g, "/"),
                previewUrl: `/outputs/${path.basename(outFile)}`,
                image: undefined,
                duration: 0
            };
            addToLibrary(item);
            imported.push(item);
        }

        res.json({ ok: true, imported });
    } catch (e) {
        res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
});

export default router;
