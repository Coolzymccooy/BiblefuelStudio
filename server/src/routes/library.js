import { Router } from "express";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { readLibrary, addToLibrary, removeFromLibrary, writeLibrary } from "../lib/library.js";
import { deriveOutputJpgPathFromVideo, generateVideoThumbnail, normalizePathSlashes, resolveOutputAlias, toOutputPublicPath } from "../lib/mediaThumb.js";
import { OUTPUT_DIR } from "../lib/paths.js";

const router = Router();

function normalizeLibraryItem(item) {
    const next = { ...item };
    let changed = false;

    const resolvedUrl = resolveOutputAlias(next.url);
    const hasLocalUrl = resolvedUrl && !String(resolvedUrl).startsWith("http") && fs.existsSync(resolvedUrl);

    if (hasLocalUrl) {
        const normalizedUrl = normalizePathSlashes(resolvedUrl);
        if (next.url !== normalizedUrl) {
            next.url = normalizedUrl;
            changed = true;
        }
        const normalizedPreview = toOutputPublicPath(resolvedUrl);
        if (normalizedPreview && next.previewUrl !== normalizedPreview) {
            next.previewUrl = normalizedPreview;
            changed = true;
        }
    } else if (next.previewUrl) {
        const previewAlias = toOutputPublicPath(next.previewUrl);
        if (previewAlias && previewAlias !== next.previewUrl) {
            next.previewUrl = previewAlias;
            changed = true;
        }
    }

    if (next.image) {
        if (String(next.image).startsWith("http://") || String(next.image).startsWith("https://")) {
            // keep remote image as-is
        } else {
            const resolvedImage = resolveOutputAlias(next.image);
            if (resolvedImage && fs.existsSync(resolvedImage)) {
                const normalizedImage = toOutputPublicPath(resolvedImage);
                if (normalizedImage && normalizedImage !== next.image) {
                    next.image = normalizedImage;
                    changed = true;
                }
            } else {
                delete next.image;
                changed = true;
            }
        }
    }

    if (!next.image && hasLocalUrl) {
        const thumb = generateVideoThumbnail(resolvedUrl, { outputBaseName: `thumb-${String(next.id || "library")}` });
        if (thumb) {
            next.image = thumb;
            changed = true;
        } else {
            const derived = deriveOutputJpgPathFromVideo(resolvedUrl);
            const derivedLocal = resolveOutputAlias(derived);
            if (derived && derivedLocal && fs.existsSync(derivedLocal)) {
                next.image = derived;
                changed = true;
            }
        }
    }

    return { item: next, changed };
}

router.get("/", (req, res) => {
    const library = readLibrary();
    const normalizedItems = [];
    let changed = false;
    for (const item of library.items || []) {
        const out = normalizeLibraryItem(item);
        normalizedItems.push(out.item);
        if (out.changed) changed = true;
    }
    if (changed) {
        writeLibrary({ ...library, items: normalizedItems });
    }
    res.json({ ok: true, library: { ...library, items: normalizedItems } });
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

        const outDir = OUTPUT_DIR;
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

        const imported = [];
        for (const filePath of files) {
            const id = `local_${uuid()}`;
            const ext = path.extname(filePath) || ".mp4";
            const outFile = path.join(outDir, `local-${id}${ext}`);
            fs.copyFileSync(filePath, outFile);
            const normalized = normalizePathSlashes(outFile);
            const previewUrl = toOutputPublicPath(normalized);
            const thumb = generateVideoThumbnail(normalized, { outputBaseName: `thumb-${id}` });
            const derived = deriveOutputJpgPathFromVideo(normalized);
            const derivedExists = derived ? fs.existsSync(resolveOutputAlias(derived)) : false;
            const item = {
                id,
                url: normalized,
                previewUrl,
                image: thumb || (derivedExists ? derived : undefined),
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
