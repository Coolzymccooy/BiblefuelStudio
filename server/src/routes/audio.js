import { Router } from "express";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { spawn } from "child_process";

const router = Router();

/**
 * Process an audio file using FFmpeg filters (a lightweight "mini-Audacity").
 * This is NOT a full DAW, but provides the most common cleanup tools:
 * - trim
 * - normalize loudness (loudnorm)
 * - noise reduction (afftdn)
 * - noise gate (agate)
 * - EQ highpass/lowpass
 * - compressor (acompressor)
 * - remove silence (silenceremove)
 *
 * Body:
 * {
 *   inputPath: string,
 *   preset?: "clean_voice"|"podcast"|"warm"|"raw",
 *   trim?: { startSec?: number, durationSec?: number },
 *   normalize?: { targetLUFS?: number },
 *   denoise?: { strength?: number },          // 0..1
 *   gate?: { thresholdDb?: number },          // e.g. -35
 *   eq?: { highpassHz?: number, lowpassHz?: number },
 *   compressor?: { ratio?: number, thresholdDb?: number, attackMs?: number, releaseMs?: number },
 *   silenceRemove?: { enabled?: boolean },
 *   deesser?: { amount?: number },             // 0..1
 *   limiter?: { ceilingDb?: number },          // e.g. -1
 *   presence?: { freqHz?: number, gainDb?: number, widthQ?: number }
 * }
 */
router.post("/process", async (req, res) => {
  try {
    const inputPath = String(req.body?.inputPath || "").trim();
    if (!inputPath || !fs.existsSync(inputPath)) {
      return res.status(400).json({ ok: false, error: "inputPath missing or not found" });
    }

    const preset = String(req.body?.preset || "clean_voice");

    // Defaults by preset
    const presets = {
      raw: {
        normalize: null, denoise: null, gate: null, eq: null, compressor: null, silenceRemove: null
      },
      clean_voice: {
        normalize: { targetLUFS: -16 },
        denoise: { strength: 0.45 },
        gate: { thresholdDb: -38 },
        eq: { highpassHz: 80, lowpassHz: 12000 },
        compressor: { ratio: 3, thresholdDb: -18, attackMs: 8, releaseMs: 120 },
        silenceRemove: { enabled: true }
      },
      podcast: {
        normalize: { targetLUFS: -14 },
        denoise: { strength: 0.35 },
        gate: { thresholdDb: -40 },
        eq: { highpassHz: 70, lowpassHz: 14000 },
        compressor: { ratio: 4, thresholdDb: -20, attackMs: 6, releaseMs: 160 },
        silenceRemove: { enabled: true }
      },
      warm: {
        normalize: { targetLUFS: -16 },
        denoise: { strength: 0.30 },
        gate: { thresholdDb: -42 },
        eq: { highpassHz: 70, lowpassHz: 10000 },
        compressor: { ratio: 2.6, thresholdDb: -19, attackMs: 10, releaseMs: 180 },
        silenceRemove: { enabled: false }
      }
    };

    const p = presets[preset] || presets.clean_voice;

    // Merge overrides
    const cfg = {
      trim: req.body?.trim || null,
      normalize: (req.body?.normalize ?? p.normalize) || null,
      denoise: (req.body?.denoise ?? p.denoise) || null,
      gate: (req.body?.gate ?? p.gate) || null,
      eq: (req.body?.eq ?? p.eq) || null,
      compressor: (req.body?.compressor ?? p.compressor) || null,
      silenceRemove: (req.body?.silenceRemove ?? p.silenceRemove) || null,
      deesser: req.body?.deesser || null,
      limiter: req.body?.limiter || null,
      presence: req.body?.presence || null,
    };

    const outDir = process.env.OUTPUT_DIR || "./outputs";
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const outFile = path.join(outDir, `audio-processed-${uuid()}.mp3`);
    const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";

    const args = ["-y"];

    // Trim via -ss/-t for speed (optional)
    if (cfg.trim?.startSec != null) args.push("-ss", String(Number(cfg.trim.startSec) || 0));
    args.push("-i", inputPath);
    if (cfg.trim?.durationSec != null) args.push("-t", String(Number(cfg.trim.durationSec) || 0));

    const filters = [];

    // Basic cleanup chain
    if (cfg.eq?.highpassHz) filters.push(`highpass=f=${Number(cfg.eq.highpassHz)}`);
    if (cfg.eq?.lowpassHz) filters.push(`lowpass=f=${Number(cfg.eq.lowpassHz)}`);

    if (cfg.denoise?.strength != null) {
      const s = Math.min(1, Math.max(0, Number(cfg.denoise.strength)));
      // afftdn: stronger values reduce more noise but can sound "watery"
      // We map 0..1 -> nr 6..24
      const nr = 6 + s * 18;
      filters.push(`afftdn=nr=${nr.toFixed(1)}`);
    }

    if (cfg.gate?.thresholdDb != null) {
      const th = Number(cfg.gate.thresholdDb);
      // agate uses linear thresholds; we use dB->linear
      // Convert dBFS to linear amplitude: 10^(dB/20)
      const lin = Math.pow(10, th / 20);
      // attack/release tuned for speech
      filters.push(`agate=threshold=${lin.toFixed(6)}:attack=10:release=200`);
    }

    if (cfg.compressor?.ratio != null || cfg.compressor?.thresholdDb != null) {
      const ratio = Number(cfg.compressor?.ratio ?? 3);
      const thdb = Number(cfg.compressor?.thresholdDb ?? -18);
      let attack = Number(cfg.compressor?.attackMs ?? 12) / 1000;
      let release = Number(cfg.compressor?.releaseMs ?? 150) / 1000;
      // Clamp to ffmpeg acompressor ranges (attack >= 0.01s)
      if (attack < 0.01) attack = 0.01;
      if (release < 0.05) release = 0.05;
      // acompressor threshold is linear
      const thlin = Math.pow(10, thdb / 20);
      filters.push(`acompressor=threshold=${thlin.toFixed(6)}:ratio=${ratio}:attack=${attack}:release=${release}:makeup=8`);
    }

    if (cfg.deesser?.amount != null) {
      const amount = Math.min(1, Math.max(0.1, Number(cfg.deesser.amount)));
      filters.push(`deesser=i=${amount}:f=0.5`);
    }

    if (cfg.presence?.gainDb != null && Number(cfg.presence.gainDb) !== 0) {
      const freq = Number(cfg.presence.freqHz ?? 4000);
      const gain = Number(cfg.presence.gainDb);
      const q = Number(cfg.presence.widthQ ?? 1.0);
      filters.push(`equalizer=f=${freq}:width_type=q:width=${q}:g=${gain}`);
    }

    if (cfg.silenceRemove?.enabled) {
      // remove near-silence at start/end and long gaps
      filters.push(`silenceremove=start_periods=1:start_duration=0.15:start_threshold=-40dB:stop_periods=1:stop_duration=0.25:stop_threshold=-40dB`);
    }

    if (cfg.normalize?.targetLUFS != null) {
      const lufs = Number(cfg.normalize.targetLUFS);
      filters.push(`loudnorm=I=${lufs}:TP=-1.5:LRA=11`);
    }

    if (cfg.limiter?.ceilingDb != null) {
      const ceilingDb = Number(cfg.limiter.ceilingDb);
      const limit = Math.min(1, Math.max(0.1, Math.pow(10, ceilingDb / 20)));
      filters.push(`alimiter=limit=${limit.toFixed(3)}`);
    }

    // If no filters, still encode to mp3
    if (filters.length > 0) {
      args.push("-af", filters.join(","));
    }

    args.push("-vn", "-c:a", "libmp3lame", "-b:a", "192k", outFile);

    const proc = spawn(ffmpeg, args);
    let stderr = "";

    proc.stderr.on("data", d => stderr += d.toString());

    proc.on("error", (err) => {
      console.error(`[AUDIO] Spawn error:`, err);
      if (!res.headersSent) {
        res.status(500).json({
          ok: false,
          error: `FFmpeg could not be started: ${err.message}`,
          details: "Check if FFMPEG_PATH in .env is correct and the file exists."
        });
      }
    });

    proc.on("close", (code) => {
      if (res.headersSent) return;
      if (code !== 0) {
        return res.status(400).json({ ok: false, error: `ffmpeg failed: ${code}`, details: stderr.slice(-2000) });
      }
      res.json({ ok: true, file: outFile, applied: cfg, filterChain: filters });
    });
  } catch (e) {
    console.error(`[AUDIO] Route error:`, e);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }
});

export default router;
