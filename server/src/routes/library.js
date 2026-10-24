import { Router } from "express";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { readLibrary, addToLibrary, removeFromLibrary, writeLibrary } from "../lib/library.js";
import { deriveOutputJpgPathFromVideo, generateVideoThumbnail, normalizePathSlashes, resolveOutputAlias, safeThumbName, toOutputPublicPath } from "../lib/mediaThumb.js";
import { confineLibraryLink } from "../lib/mediaInputScope.js";
import { CATEGORIES, classifySearchQuery, normalizeCategories } from "../lib/categorize.js";
import { isOwnerCtx } from "../lib/paths.js";
import { isInsideDir } from "../lib/pathJail.js";
import { confineUserPath, sendUserPathError, UserPathError } from "../lib/userPathScope.js";

const router = Router();

const LIBRARY_ID = /^[A-Za-z0-9_-]{1,200}$/;
const isHttpLink = (value) => /^https?:[/][/]/i.test(String(value || "").trim());

/** The links of a library item that are read later (thumbnails, renders). */
function itemLinks(item) {
    const files = Array.isArray(item.files) ? item.files.map((f) => f?.link) : [];
    return [item.url, item.previewUrl, item.image, ...files].filter((v) => v != null && String(v).trim() !== "");
}

/**
 * Every local link must be the caller's own file (#112): a saved item is read
 * later by the thumbnail run below and by renders. Stock https links stay.
 */
function assertItemLinksInScope(item, ctx) {
    for (const link of itemLinks(item)) {
        if (!isHttpLink(link)) confineLibraryLink(String(link), ctx);
    }
}

/** The real path of a local link inside the caller's folder that exists, else null. */
function confinedLocal(value, ctx) {
    if (!value || isHttpLink(value)) return null;
    try {
        const real = confineLibraryLink(String(value), ctx);
        return real && fs.existsSync(real) ? real : null;
    } catch (err) {
        if (err instanceof UserPathError) return null;
        throw err;
    }
}

function normalizeLibraryItem(item, ctx) {
    const next = { ...item };
    let changed = false;

    // Only a video in the caller's own folder is normalised or thumbnailed
    // (#112): a stored link elsewhere is left as it is, never read.
    const localUrl = confinedLocal(next.url, ctx);

    if (localUrl) {
        const normalizedUrl = normalizePathSlashes(localUrl);
        if (next.url !== normalizedUrl) {
            next.url = normalizedUrl;
            changed = true;
        }
        const normalizedPreview = toOutputPublicPath(localUrl);
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

    if (next.image && !isHttpLink(next.image)) {
        // A local image outside the caller's folder is dropped like a missing one.
        const localImage = confinedLocal(next.image, ctx);
        const normalizedImage = localImage ? toOutputPublicPath(localImage) : "";
        if (normalizedImage) {
            if (normalizedImage !== next.image) {
                next.image = normalizedImage;
                changed = true;
            }
        } else {
            delete next.image;
            changed = true;
        }
    }

    if (!next.image && localUrl) {
        // Stored ids predate the /add check, so the name is rebuilt from a sanitised one.
        const safeId = safeThumbName(String(next.id || "library").replace(/[^A-Za-z0-9_-]/g, "_"));
        const thumb = generateVideoThumbnail(localUrl, { outputBaseName: `thumb-${safeId}`, outputDir: ctx.outputDir });
        if (thumb) {
            next.image = thumb;
            changed = true;
        } else {
            const derived = deriveOutputJpgPathFromVideo(localUrl);
            if (derived && confinedLocal(derived, ctx)) {
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
        const out = normalizeLibraryItem(item, req.ctx);
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
    const id = typeof item.id === "number" ? String(item.id) : item.id;
    if (typeof id !== "string" || !LIBRARY_ID.test(id)) {
        return res.status(400).json({ ok: false, error: "INVALID_ID", message: "id must be 1-200 letters, digits, dashes or underscores." });
    }
    try {
        assertItemLinksInScope(item, req.ctx);
    } catch (err) {
        if (sendUserPathError(res, err)) return;
        throw err;
    }
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
            const thumb = generateVideoThumbnail(normalized, { outputBaseName: `thumb-${id}`, outputDir: req.ctx.outputDir });
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
