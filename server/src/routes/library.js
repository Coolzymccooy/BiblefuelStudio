import { Router } from "express";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { readLibrary, addToLibrary, removeFromLibrary, writeLibrary } from "../lib/library.js";
import { deriveOutputJpgPathFromVideo, generateVideoThumbnail, normalizePathSlashes, resolveOutputAlias, toOutputPublicPath } from "../lib/mediaThumb.js";
import { CATEGORIES, classifySearchQuery, normalizeCategories } from "../lib/categorize.js";
import { isOwnerCtx } from "../lib/paths.js";
import { isInsideDir } from "../lib/pathJail.js";
import { confineUserPath, UserPathError } from "../lib/userPathScope.js";

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
    const library = readLibrary(req.ctx.dataDir);
    const normalizedItems = [];
    let changed = false;
    for (const item of library.items || []) {
        const out = normalizeLibraryItem(item);
        normalizedItems.push(out.item);
        if (out.changed) changed = true;
    }
    if (changed) {
        writeLibrary(req.ctx.dataDir, { ...library, items: normalizedItems });
    }
    res.json({ ok: true, library: { ...library, items: normalizedItems } });
});

router.post("/add", (req, res) => {
    const item = req.body || {};
    if (!item.id) return res.status(400).json({ ok: false, error: "id required" });
    addToLibrary(req.ctx.dataDir, item);
    res.json({ ok: true });
});

router.delete("/:id", (req, res) => {
    removeFromLibrary(req.ctx.dataDir, req.params.id);
    res.json({ ok: true });
});

router.get("/categories", (req, res) => {
    res.json({ ok: true, categories: CATEGORIES });
});

router.patch("/:id/categories", (req, res) => {
    const id = String(req.params?.id || "").trim();
    if (!id) return res.status(400).json({ ok: false, error: "id required" });
    const lib = readLibrary(req.ctx.dataDir);
    const idx = (lib.items || []).findIndex((x) => String(x.id) === id);
    if (idx < 0) return res.status(404).json({ ok: false, error: "library item not found" });

    const incoming = Array.isArray(req.body?.categories) ? req.body.categories : [];
    const next = normalizeCategories(incoming);
    lib.items[idx] = { ...lib.items[idx], categories: next, updatedAt: new Date().toISOString() };
    writeLibrary(req.ctx.dataDir, lib);
    res.json({ ok: true, item: lib.items[idx] });
});

// Bulk auto-tag any items missing categories — best-effort, infers from
// existing item metadata (searchQuery, sourceUrl, id, etc.).
router.post("/auto-tag", (req, res) => {
    const lib = readLibrary(req.ctx.dataDir);
    let tagged = 0;
    for (const item of lib.items || []) {
        if (Array.isArray(item.categories) && item.categories.length > 0) continue;
        const hint = [item.searchQuery, item.title, item.sourceUrl, item.id]
            .filter(Boolean).join(" ");
        const auto = classifySearchQuery(hint);
        if (auto.length > 0) {
            item.categories = auto;
            item.updatedAt = new Date().toISOString();
            tagged += 1;
        }
    }
    if (tagged > 0) writeLibrary(req.ctx.dataDir, lib);
    res.json({ ok: true, tagged, total: (lib.items || []).length });
});

/**
 * Import-local reads a folder on the server, so only the owner may use it
 * (#112), and only from a folder inside their own outputs folder: anything
 * else would let a request copy any video the server can read into a
 * library. A missing folder and one outside get the same answer.
 */
const FOLDER_NOT_AVAILABLE = {
    ok: false,
    error: "FOLDER_NOT_AVAILABLE",
    message: "That folder is not available. Use a folder inside your outputs folder.",
};
const LOCAL_VIDEO_EXTS = new Set([".mp4", ".mov", ".webm", ".m4v"]);

/** The folder's real path when it is a directory inside the owner's outputs folder, else null. */
function confineImportFolder(folderPath, ctx) {
    try {
        const real = confineUserPath(folderPath, ctx);
        return fs.statSync(real).isDirectory() ? real : null;
    } catch (err) {
        if (err instanceof UserPathError && err.status < 500) return null;
        throw err;
    }
}

/** Videos directly in `folder` whose real path is still inside it (a link inside cannot lead out). */
function listImportableVideos(folder) {
    const files = [];
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        if (!LOCAL_VIDEO_EXTS.has(path.extname(entry.name).toLowerCase())) continue;
        let real;
        try {
            real = fs.realpathSync(path.join(folder, entry.name));
        } catch {
            continue;
        }
        if (!isInsideDir(real, folder) || !fs.statSync(real).isFile()) continue;
        files.push(real);
    }
    return files;
}

router.get("/import-local", (req, res) => {
    res.json({ ok: true, allowed: isOwnerCtx(req.ctx) });
});

router.post("/import-local", (req, res) => {
    try {
        if (!isOwnerCtx(req.ctx)) {
            return res.status(403).json({ ok: false, error: "OWNER_ONLY", message: "Only the studio owner can import a server folder." });
        }
        const folderPath = String(req.body?.folderPath || "").trim();
        if (!folderPath) return res.status(400).json({ ok: false, error: "folderPath required" });
        const folder = confineImportFolder(folderPath, req.ctx);
        if (!folder) return res.status(400).json(FOLDER_NOT_AVAILABLE);

        const files = listImportableVideos(folder);

        const outDir = req.ctx.outputDir;
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
            addToLibrary(req.ctx.dataDir, item);
            imported.push(item);
        }

        res.json({ ok: true, imported });
    } catch (e) {
        console.error("[library] import-local failed:", e?.message || e);
        res.status(500).json({ ok: false, error: "IMPORT_FAILED", message: "The folder could not be imported." });
    }
});

export default router;
