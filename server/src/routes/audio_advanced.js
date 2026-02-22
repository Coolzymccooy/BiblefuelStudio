import { Router } from "express";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { spawn } from "child_process";
import { readLibrary } from "../lib/library.js";
import { OUTPUT_DIR } from "../lib/paths.js";

const router = Router();

function resolveAssetPath(pathOrId) {
  if (pathOrId == null) return null;
  const normalized = String(pathOrId).trim();
  if (!normalized) return null;
  if (normalized.startsWith('http')) return normalized;
  if (fs.existsSync(normalized)) return normalized;

  const lib = readLibrary();
  const item = lib.items.find(x => String(x.id) === normalized);
  if (item) {
    if (Array.isArray(item.files) && item.files.length > 0) {
      const sorted = item.files.slice().sort((a, b) => (b.width || 0) - (a.width || 0));
      const hd = sorted.find(f => f.quality === 'hd') || sorted[0];
      if (hd?.link) return hd.link;
    }
    if (item.previewUrl) return item.previewUrl;
    if (item.url) return item.url;
  }

  return normalized;
}

function isLocalOrRemote(p) {
  if (!p) return false;
  if (p.startsWith('http')) return true;
  return fs.existsSync(p);
}

function run(ffmpeg, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, args);
    let stderr = "";
    proc.stderr.on("data", d => stderr += d.toString());
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg failed: ${code}\n${stderr.slice(-2000)}`));
      resolve({ stderr });
    });
  });
}

/**
 * Generate a waveform preview PNG from an audio file.
 * Query: ?inputPath=...&w=1200&h=300
 */
router.get("/waveform.png", async (req, res) => {
  try {
    const inputPath = String(req.query?.inputPath || "").trim();
    if (!inputPath || !fs.existsSync(inputPath)) {
      return res.status(400).json({ ok: false, error: "inputPath missing or not found" });
    }
    const w = Math.min(2000, Math.max(400, Number(req.query?.w || 1200)));
    const h = Math.min(800, Math.max(200, Number(req.query?.h || 300)));

    const outDir = OUTPUT_DIR;
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const outFile = path.join(outDir, `waveform-${uuid()}.png`);
    const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";

    const args = ["-y", "-i", inputPath, "-filter_complex", `showwavespic=s=${w}x${h}:colors=White`, "-frames:v", "1", outFile];
    await run(ffmpeg, args);

    res.setHeader("Content-Type", "image/png");
    fs.createReadStream(outFile).pipe(res);
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * Patch/merge multiple audio clips into one MP3 (concat).
 * Body: { inputs: string[], preset?: string, fades?: {inMs?:number,outMs?:number}, deess?: {enabled?:boolean, amount?: number}, normalizeLUFS?: number }
 */
router.post("/merge", async (req, res) => {
  try {
    const inputs = Array.isArray(req.body?.inputs) ? req.body.inputs.map(String).map(s => s.trim()).filter(Boolean) : [];
    if (inputs.length < 2) return res.status(400).json({ ok: false, error: "inputs[] needs at least 2 paths" });
    const resolvedInputs = inputs.map(resolveAssetPath);
    for (const p of resolvedInputs) {
      if (!isLocalOrRemote(p)) return res.status(400).json({ ok: false, error: `file not found: ${p}` });
    }

    const outDir = OUTPUT_DIR;
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const listFile = path.join(outDir, `concat-${uuid()}.txt`);
    fs.writeFileSync(listFile, resolvedInputs.map(p => {
      if (p.startsWith('http')) return `file '${p}'`;
      const abs = path.resolve(p);
      return `file '${abs.replace(/'/g, "'\\''")}'`;
    }).join("\n"));

    const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
    const outFile = path.join(outDir, `audio-merged-${uuid()}.mp3`);

    // concat demuxer then optional filters
    const filters = [];
    const fades = req.body?.fades || null;
    if (fades?.inMs) filters.push(`afade=t=in:st=0:d=${Number(fades.inMs) / 1000}`);
    if (fades?.outMs) filters.push(`afade=t=out:st=0:d=${Number(fades.outMs) / 1000}`); // st auto-adjust with -shortest in final encode

    const deess = req.body?.deess || null;
    if (deess?.enabled) {
      const amount = Math.min(1, Math.max(0.1, Number(deess.amount ?? 0.5)));
      // ffmpeg deesser: i (intensity) default 0.5; f (frequency) default 4000
      filters.push(`deesser=i=${amount}:f=0.5`);
    }

    const lufs = req.body?.normalizeLUFS;
    if (lufs != null) {
      filters.push(`loudnorm=I=${Number(lufs)}:TP=-1.5:LRA=11`);
    }

    const args = ["-y", "-f", "concat", "-safe", "0", "-i", listFile];
    if (filters.length) args.push("-af", filters.join(","));
    args.push("-vn", "-c:a", "libmp3lame", "-b:a", "192k", outFile);

    await run(ffmpeg, args);
    try { fs.unlinkSync(listFile); } catch { }
    res.json({ ok: true, file: outFile, inputs, filters });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * Timeline render: concat clips with per-clip trim (start/duration).
 * Body: {
 *   clips: [{ path: string, startSec?: number, durationSec?: number }],
 *   normalizeLUFS?: number,
 *   deess?: { enabled?: boolean, amount?: number },
 *   fades?: { inMs?: number, outMs?: number },
     *   crossfadeMs?: number
 * }
 */
router.post("/timeline", async (req, res) => {
  try {
    const clips = Array.isArray(req.body?.clips) ? req.body.clips : [];
    if (clips.length < 1) return res.status(400).json({ ok: false, error: "clips[] required" });

    const cleaned = clips.map((c) => ({
      path: resolveAssetPath(String(c?.path || "").trim()),
      startSec: c?.startSec != null ? Number(c.startSec) : null,
      durationSec: c?.durationSec != null ? Number(c.durationSec) : null,
    })).filter(c => c.path);

    if (cleaned.length < 1) return res.status(400).json({ ok: false, error: "No valid clip paths" });
    for (const c of cleaned) {
      if (!isLocalOrRemote(c.path)) return res.status(400).json({ ok: false, error: `file not found: ${c.path}` });
    }

    const outDir = OUTPUT_DIR;
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
    const outFile = path.join(outDir, `audio-timeline-${uuid()}.mp3`);

    const args = ["-y"];
    cleaned.forEach(c => { args.push("-i", c.path); });

    const parts = [];
    cleaned.forEach((c, idx) => {
      const trims = [];
      if (c.startSec != null && !Number.isNaN(c.startSec)) trims.push(`atrim=start=${Math.max(0, c.startSec)}`);
      if (c.durationSec != null && !Number.isNaN(c.durationSec) && c.durationSec > 0) trims.push(`atrim=duration=${c.durationSec}`);
      trims.push("asetpts=N/SR/TB");
      parts.push(`[${idx}:a]${trims.join(",")}[a${idx}]`);
    });
    const concatInputs = cleaned.map((_, idx) => `[a${idx}]`).join("");
    parts.push(`${concatInputs}concat=n=${cleaned.length}:v=0:a=1[aout]`);

    const post = [];
    const fades = req.body?.fades || null;
    if (fades?.inMs) post.push(`afade=t=in:st=0:d=${Number(fades.inMs) / 1000}`);
    if (fades?.outMs) post.push(`afade=t=out:st=0:d=${Number(fades.outMs) / 1000}`);

    const deess = req.body?.deess || null;
    if (deess?.enabled) {
      const amount = Math.min(1, Math.max(0.1, Number(deess.amount ?? 0.55)));
      post.push(`deesser=i=${amount}:f=0.5`);
    }

    const lufs = req.body?.normalizeLUFS;
    if (lufs != null) post.push(`loudnorm=I=${Number(lufs)}:TP=-1.5:LRA=11`);

    let filterComplex = parts.join(";");
    if (post.length) {
      filterComplex += `;[aout]${post.join(",")}[afinal]`;
    }

    args.push("-filter_complex", filterComplex);
    args.push("-map", post.length ? "[afinal]" : "[aout]");
    args.push("-vn", "-c:a", "libmp3lame", "-b:a", "192k", outFile);

    const proc = spawn(ffmpeg, args);
    let stderr = "";
    proc.stderr.on("data", d => stderr += d.toString());
    proc.on("close", (code) => {
      if (code !== 0) {
        return res.status(400).json({ ok: false, error: `ffmpeg failed: ${code}`, details: stderr.slice(-2000), filterComplex });
      }
      res.json({ ok: true, file: outFile, clips: cleaned, filterComplex });
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * Get basic info about an audio file (duration).
 * Query: ?inputPath=...
 */
router.get("/info", async (req, res) => {
  try {
    const inputPath = String(req.query?.inputPath || "").trim();
    if (!inputPath || !fs.existsSync(inputPath)) {
      return res.status(400).json({ ok: false, error: "inputPath missing or not found" });
    }
    const ffprobe = process.env.FFPROBE_PATH?.trim() || "ffprobe";
    const args = ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", inputPath];
    const proc = spawn(ffprobe, args);
    let out = "";
    let err = "";
    proc.stdout.on("data", d => out += d.toString());
    proc.stderr.on("data", d => err += d.toString());
    proc.on("close", (code) => {
      if (code !== 0) {
        return res.status(400).json({ ok: false, error: `ffprobe failed: ${code}`, details: err.slice(-1000) });
      }
      const durationSec = Number(String(out).trim());
      res.json({ ok: true, durationSec: Number.isFinite(durationSec) ? durationSec : null });
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * Timeline preview: Merge audio and overlay on background video.
 */
router.post("/timeline-preview", async (req, res) => {
  try {
    const clips = Array.isArray(req.body?.clips) ? req.body.clips : [];
    if (clips.length < 1) return res.status(400).json({ ok: false, error: "clips[] required" });

    const bg = resolveAssetPath(String(req.body?.backgroundPath || "").trim());
    if (!bg || !isLocalOrRemote(bg)) return res.status(400).json({ ok: false, error: "backgroundPath missing or invalid" });

    const cleaned = clips.map((c) => ({
      path: resolveAssetPath(String(c?.path || "").trim()),
      startSec: c?.startSec != null ? Number(c.startSec) : null,
      durationSec: c?.durationSec != null ? Number(c.durationSec) : null,
    })).filter(c => c.path);

    for (const c of cleaned) {
      if (!isLocalOrRemote(c.path)) return res.status(400).json({ ok: false, error: `file not found: ${c.path}` });
    }

    const outDir = OUTPUT_DIR;
    const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
    const outFile = path.join(outDir, `timeline-preview-${uuid()}.mp4`);

    const args = ["-y", "-stream_loop", "-1", "-i", bg];
    cleaned.forEach(c => args.push("-i", c.path));

    const parts = [];
    cleaned.forEach((c, idx) => {
      const trims = [];
      if (c.startSec != null) trims.push(`atrim=start=${Math.max(0, c.startSec)}`);
      if (c.durationSec != null) trims.push(`atrim=duration=${c.durationSec}`);
      trims.push("asetpts=N/SR/TB");
      parts.push(`[${idx + 1}:a]${trims.join(",")}[a${idx}]`);
    });

    const concatInputs = cleaned.map((_, idx) => `[a${idx}]`).join("");
    parts.push(`${concatInputs}concat=n=${cleaned.length}:v=0:a=1[amerged]`);

    // Post processing for audio
    const post = [];
    const fades = req.body?.fades || null;
    if (fades?.inMs) post.push(`afade=t=in:st=0:d=${Number(fades.inMs) / 1000}`);
    if (fades?.outMs) post.push(`afade=t=out:st=0:d=${Number(fades.outMs) / 1000}`);
    const lufs = req.body?.normalizeLUFS;
    if (lufs != null) post.push(`loudnorm=I=${Number(lufs)}:TP=-1.5:LRA=11`);

    if (post.length) {
      parts.push(`[amerged]${post.join(",")}[afinal]`);
    } else {
      parts.push(`[amerged]alias[afinal]`); // Just a label
    }

    const filterComplex = parts.join(";");
    args.push("-filter_complex", filterComplex);
    args.push("-map", "0:v", "-map", "[afinal]");
    args.push("-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", outFile);

    await run(ffmpeg, args);
    res.json({ ok: true, file: outFile });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
