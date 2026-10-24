import { Router } from "express";
import fs from "fs";
import path from "path";
import { resolveOutputAlias } from "../lib/mediaThumb.js";
import { isFirebaseAdminEnabled, uploadLocalFileToFirebase } from "../lib/firebaseAdmin.js";

// Only finished media may be copied to the bucket.
const MEDIA_EXT = new Set([".mp4", ".mov", ".webm", ".m4v", ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".jpg", ".jpeg", ".png", ".webp", ".gif"]);

/**
 * The real path of `input` when it is a media file inside `outputDir` (the
 * caller's own outputs folder); otherwise null. Links are followed before the
 * check, so neither "../" nor a symlink can reach the server's files.
 */
export function ownOutputFile(input, outputDir) {
  if (!outputDir) return null;
  const raw = String(input || "").trim();
  if (!raw || raw.startsWith("http")) return null;
  let candidate = resolveOutputAlias(raw);
  // "/outputs/x" resolves against the owner's folder; a user's files live in their own.
  if (/^\.?\/?outputs\//.test(raw.replace(/\\/g, "/"))) {
    candidate = path.join(outputDir, raw.replace(/\\/g, "/").replace(/^\.?\/?outputs\//, ""));
  }
  try {
    const real = fs.realpathSync(path.resolve(candidate));
    const root = fs.realpathSync(path.resolve(outputDir));
    if (!real.startsWith(root + path.sep)) return null;
    if (!fs.statSync(real).isFile() || !MEDIA_EXT.has(path.extname(real).toLowerCase())) return null;
    return real;
  } catch {
    return null;
  }
}

export function createFirebaseRouter({ enabled = isFirebaseAdminEnabled, upload = uploadLocalFileToFirebase } = {}) {
  const router = Router();

  router.get("/status", (req, res) => {
    res.json({ ok: true, enabled: enabled() });
  });

  router.post("/upload-output", async (req, res) => {
    try {
      if (!enabled()) {
        return res.status(400).json({ ok: false, error: "Firebase Storage not configured" });
      }
      const inputPath = String(req.body?.path || req.body?.filePath || "").trim();
      if (!inputPath) return res.status(400).json({ ok: false, error: "path required" });

      const localPath = ownOutputFile(inputPath, req.ctx?.outputDir);
      if (!localPath) {
        return res.status(400).json({ ok: false, error: "Only a video, audio or image file from your own outputs can be uploaded." });
      }

      // Each user's copies go in their own folder; the caller does not choose it.
      const userSegment = String(req.ctx?.userId || "anon").replace(/[^A-Za-z0-9_-]/g, "_");
      const uploaded = await upload(localPath, { prefix: `outputs/${userSegment}` });
      res.json({ ok: true, uploaded });
    } catch (e) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  return router;
}

export default createFirebaseRouter();
