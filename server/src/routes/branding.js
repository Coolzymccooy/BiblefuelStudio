import { Router } from "express";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { v4 as uuid } from "uuid";
import { readBranding, writeBranding, logoFileFor } from "../lib/branding.js";
import { receiveUploadToFile, finaliseImageFile } from "./media.js";

/**
 * The account's video logo: settings, and the logo image itself.
 *
 *   GET    /api/branding        settings, plus the logo as a data URL to preview
 *   PUT    /api/branding        { enabled?, position?, size?, opacity? }
 *   POST   /api/branding/logo   raw image body (PNG, JPEG or WebP); turns branding on
 *   DELETE /api/branding/logo   removes the logo; turns branding off
 *
 * Everything is scoped to req.ctx.dataDir, so an account only ever sees and
 * changes its own logo.
 */
const router = Router();

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
// The stored logo fits a 512px box: sharp at the largest size it is drawn
// (about 300px wide on 4K) and small enough to return inline for the preview.
const LOGO_BOX = 512;

function withPreview(dataDir, branding) {
  if (!branding.hasLogo) return { ...branding, logoDataUrl: null };
  const b64 = fs.readFileSync(logoFileFor(dataDir)).toString("base64");
  return { ...branding, logoDataUrl: `data:image/png;base64,${b64}` };
}

/** Re-encode any accepted image as a transparent PNG, shrunk (never enlarged) into the 512px box. */
export function normaliseLogo(src, dest, { timeoutMs = 20000 } = {}) {
  const ff = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  const args = [
    "-y", "-v", "error", "-i", src,
    "-vf", `scale='min(${LOGO_BOX},iw)':'min(${LOGO_BOX},ih)':force_original_aspect_ratio=decrease,format=rgba`,
    "-frames:v", "1", dest,
  ];
  return new Promise((resolve) => {
    let err = "";
    let proc;
    try {
      proc = spawn(ff, args, { windowsHide: true });
    } catch (e) {
      return resolve({ ok: false, error: String(e?.message || e) });
    }
    const timer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, timeoutMs);
    proc.stderr.on("data", (d) => { err += d.toString(); });
    proc.on("error", (e) => { clearTimeout(timer); resolve({ ok: false, error: String(e?.message || e) }); });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && fs.existsSync(dest)) return resolve({ ok: true });
      resolve({ ok: false, error: err.trim().split("\n").pop() || `ffmpeg exited ${code}` });
    });
  });
}

router.get("/", (req, res) => {
  try {
    res.json({ ok: true, branding: withPreview(req.ctx.dataDir, readBranding(req.ctx.dataDir)) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.put("/", (req, res) => {
  try {
    const body = req.body || {};
    const patch = {};
    for (const key of ["enabled", "position", "size", "opacity"]) {
      if (Object.hasOwn(body, key)) patch[key] = body[key];
    }
    const current = readBranding(req.ctx.dataDir);
    if (patch.enabled === true && !current.hasLogo) {
      return res.status(400).json({ ok: false, error: "Upload a logo before turning it on" });
    }
    const next = writeBranding(req.ctx.dataDir, patch);
    res.json({ ok: true, branding: withPreview(req.ctx.dataDir, next) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.post("/logo", async (req, res) => {
  const dataDir = req.ctx.dataDir;
  const dir = path.dirname(logoFileFor(dataDir));
  const tmp = path.join(dir, `upload-${uuid()}.img`);
  let received = null;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const recv = await receiveUploadToFile(req, tmp, { maxBytes: MAX_LOGO_BYTES });
    if (!recv.ok) return res.status(recv.status || 400).json({ ok: false, error: recv.error });
    const img = await finaliseImageFile(tmp);
    if (!img.ok) return res.status(400).json({ ok: false, error: img.error });
    received = img.file;
    if (!/^image\/(png|jpeg|webp)$/.test(img.mime)) {
      return res.status(400).json({ ok: false, error: "Use a PNG, JPEG or WebP image" });
    }
    const staged = path.join(dir, `logo-${uuid()}.png`);
    const norm = await normaliseLogo(received, staged);
    if (!norm.ok) {
      try { fs.rmSync(staged, { force: true }); } catch {}
      return res.status(400).json({ ok: false, error: `That image couldn't be read: ${norm.error}` });
    }
    fs.renameSync(staged, logoFileFor(dataDir));
    const next = writeBranding(dataDir, { enabled: true });
    res.json({ ok: true, branding: withPreview(dataDir, { ...next, hasLogo: true }) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  } finally {
    for (const f of [tmp, received]) {
      if (f) try { fs.rmSync(f, { force: true }); } catch {}
    }
  }
});

router.delete("/logo", (req, res) => {
  try {
    fs.rmSync(logoFileFor(req.ctx.dataDir), { force: true });
    const next = writeBranding(req.ctx.dataDir, { enabled: false });
    res.json({ ok: true, branding: withPreview(req.ctx.dataDir, { ...next, hasLogo: false }) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
