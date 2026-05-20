import { Router } from "express";
import fetch, { File, FormData } from "node-fetch";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { OUTPUT_DIR } from "../lib/paths.js";
import { synthesizeEdgeTts } from "../lib/edgeTts.js";
import { synthesizeElevenLabs } from "../lib/elevenLabsTts.js";
import { synthesizeTts } from "../lib/ttsOrchestrator.js";
import {
  PROFILES,
  listCategories,
  resolveProfile,
  synthesizeForCategory,
  describeProviders,
} from "../lib/voice/index.js";

const router = Router();
const allowedAudioExt = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".webm"]);

const DEFAULT_EDGE_VOICE = "en-US-AriaNeural";
const EDGE_TTS_TIMEOUT_MS = 20_000;

function isEdgeEnabled() {
  return (process.env.EDGE_TTS_ENABLED ?? "true").toLowerCase() !== "false";
}

function defaultEdgeVoice() {
  const v = (process.env.EDGE_TTS_VOICE || DEFAULT_EDGE_VOICE).trim();
  return v.length > 0 ? v : DEFAULT_EDGE_VOICE;
}

function getElevenLabsApiKey() {
  const rawKey = (process.env.ELEVENLABS_API_KEY || "");
  return rawKey.replace(/['"]/g, "").trim();
}

function mimeFromExt(ext) {
  switch (ext) {
    case ".mp3": return "audio/mpeg";
    case ".wav": return "audio/wav";
    case ".m4a": return "audio/mp4";
    case ".aac": return "audio/aac";
    case ".ogg": return "audio/ogg";
    case ".flac": return "audio/flac";
    case ".webm": return "audio/webm";
    default: return "application/octet-stream";
  }
}

function resolveSampleAudioPath(inputPath) {
  const raw = String(inputPath || "").trim();
  if (!raw) return null;

  const candidates = new Set();
  candidates.add(raw);
  candidates.add(path.resolve(raw));
  candidates.add(path.resolve(process.cwd(), raw));
  candidates.add(path.resolve(process.cwd(), "..", raw));

  if (raw.startsWith("server/") || raw.startsWith("server\\")) {
    const withoutServerPrefix = raw.replace(/^server[\\/]/, "");
    candidates.add(path.resolve(process.cwd(), withoutServerPrefix));
    candidates.add(path.resolve(process.cwd(), "..", withoutServerPrefix));
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  return null;
}

router.get("/voices", async (req, res) => {
  const provider = String(req.query?.provider || "elevenlabs").toLowerCase();

  if (provider === "edge") {
    if (!isEdgeEnabled()) {
      return res.status(400).json({ ok: false, error: "Edge-TTS disabled (EDGE_TTS_ENABLED=false)" });
    }
    const tts = new MsEdgeTTS();
    try {
      const voices = await tts.getVoices();
      // Normalise to a shape close to ElevenLabs's so the UI doesn't branch
      // heavily — voice_id, name, locale, gender, friendly metadata.
      const normalised = (voices || []).map((v) => ({
        voice_id: v.ShortName,
        name: v.FriendlyName || v.ShortName,
        locale: v.Locale,
        gender: v.Gender,
        labels: { provider: "edge", status: v.Status, codec: v.SuggestedCodec },
      }));
      return res.json({ ok: true, provider: "edge", voices: normalised });
    } catch (e) {
      return res.status(502).json({ ok: false, error: `Edge-TTS voices fetch failed: ${e?.message || e}` });
    } finally {
      try { tts.close(); } catch { /* best-effort */ }
    }
  }

  // Default: ElevenLabs
  try {
    const apiKey = getElevenLabsApiKey();
    if (!apiKey || apiKey.startsWith("your-")) {
      return res.status(400).json({ ok: false, error: "ELEVENLABS_API_KEY missing or invalid" });
    }

    const resp = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json"
      }
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`ElevenLabs error: ${resp.status} ${errText}`);
    }

    const data = await resp.json();
    res.json({ ok: true, provider: "elevenlabs", voices: data?.voices || [] });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.post("/clone-voice", async (req, res) => {
  try {
    const apiKey = getElevenLabsApiKey();
    if (!apiKey || apiKey.startsWith("your-")) {
      return res.status(400).json({ ok: false, error: "ELEVENLABS_API_KEY missing or invalid" });
    }

    const name = String(req.body?.name || "").trim();
    const description = String(req.body?.description || "").trim();
    const samplePaths = Array.isArray(req.body?.samplePaths)
      ? req.body.samplePaths.map((x) => String(x || "").trim()).filter(Boolean)
      : [];

    if (name.length < 2) {
      return res.status(400).json({ ok: false, error: "Voice name is required (min 2 chars)" });
    }
    if (samplePaths.length < 1) {
      return res.status(400).json({ ok: false, error: "At least one sample audio path is required" });
    }
    if (samplePaths.length > 25) {
      return res.status(400).json({ ok: false, error: "Too many sample files (max 25)" });
    }

    const consent = req.body?.consent || {};
    const hasRights = Boolean(consent?.hasRights);
    const noImpersonation = Boolean(consent?.noImpersonation);
    const termsAccepted = Boolean(consent?.termsAccepted);
    if (!hasRights || !noImpersonation || !termsAccepted) {
      return res.status(400).json({
        ok: false,
        error: "Consent required: confirm rights/permission, no impersonation, and ElevenLabs terms."
      });
    }

    const files = [];
    for (const p of samplePaths) {
      const resolved = resolveSampleAudioPath(p);
      if (!resolved || !fs.existsSync(resolved)) {
        return res.status(400).json({ ok: false, error: `Sample file not found: ${p}` });
      }
      const ext = path.extname(resolved).toLowerCase();
      if (!allowedAudioExt.has(ext)) {
        return res.status(400).json({ ok: false, error: `Unsupported sample format: ${ext}` });
      }
      const stat = fs.statSync(resolved);
      if (!stat.size || stat.size < 2048) {
        return res.status(400).json({ ok: false, error: `Sample file is too small: ${p}` });
      }
      files.push({
        path: resolved,
        name: path.basename(resolved),
        mime: mimeFromExt(ext),
      });
    }

    const form = new FormData();
    form.set("name", name);
    if (description) form.set("description", description);
    form.set("remove_background_noise", String(req.body?.removeBackgroundNoise ?? true));

    const labels = req.body?.labels;
    if (labels && typeof labels === "object") {
      form.set("labels", JSON.stringify(labels));
    }

    for (const fileMeta of files) {
      const bytes = fs.readFileSync(fileMeta.path);
      form.append("files", new File([bytes], fileMeta.name, { type: fileMeta.mime }));
    }

    const resp = await fetch("https://api.elevenlabs.io/v1/voices/add", {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
      },
      body: form,
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return res.status(resp.status).json({ ok: false, error: `ElevenLabs clone error: ${resp.status} ${errText}` });
    }

    const data = await resp.json();
    res.json({
      ok: true,
      voiceId: data?.voice_id || "",
      voice: data || null,
    });
  } catch (e) {
    console.error("[TTS] Clone route error:", e);
    const status = Number(e?.status || e?.statusCode || 500);
    res.status(Number.isFinite(status) ? status : 500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.post("/elevenlabs", async (req, res) => {
  const { text, voiceId, voiceSettings, modelId } = req.body || {};
  try {
    const result = await synthesizeElevenLabs({ text, voiceId, voiceSettings, modelId });
    res.json(result);
  } catch (e) {
    console.error(`[TTS] ElevenLabs route error:`, e);
    const message = String(e?.message || e);
    const status = message.toLowerCase().includes("missing") || message.toLowerCase().includes("required") ? 400 : 502;
    res.status(status).json({ ok: false, error: message });
  }
});

// Convenience route: ElevenLabs first, Edge-TTS automatic fallback.
router.post("/auto", async (req, res) => {
  const { text, voiceId } = req.body || {};
  try {
    const result = await synthesizeTts({ text, voiceId });
    res.json(result);
  } catch (e) {
    console.error(`[TTS] auto route error:`, e);
    res.status(502).json({ ok: false, error: String(e?.message || e) });
  }
});

// ─── Edge-TTS (free Microsoft "Read Aloud" service) ───────────────────────
// Writes a 24kHz/48kbps mono MP3 to OUTPUT_DIR. Same return shape as the
// ElevenLabs route ({ ok, file }) so the render pipeline doesn't branch.
// Unofficial API — flip EDGE_TTS_ENABLED=false to disable instantly if MS
// tightens the screws.

function collectStream(stream, timeoutMs) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const timer = setTimeout(() => {
      stream.removeAllListeners();
      reject(new Error(`edge-tts stream timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    stream.on("end", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    });
    stream.on("close", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    });
  });
}

// ─── Voice profiles + category-aware synthesis ────────────────────────────
// Project 2 of the voice synthesis engine. These routes power the upcoming
// settings panel UI and let the render pipeline request "read this prayer"
// or "read this scripture" without having to know provider parameters.

router.get("/providers", (_req, res) => {
  res.json({ ok: true, providers: describeProviders() });
});

router.get("/profiles", (_req, res) => {
  const categories = listCategories();
  const profiles = categories.map((c) => {
    const p = PROFILES[c];
    return {
      category: p.category,
      label: p.label,
      description: p.description,
      providerPreference: p.providerPreference,
      recommendedTypographyPreset: p.recommendedTypographyPreset,
    };
  });
  res.json({ ok: true, profiles });
});

router.post("/synthesize-category", async (req, res) => {
  const { text, category, withTimestamps, preferredProvider, overrides } = req.body || {};
  try {
    const result = await synthesizeForCategory({
      text,
      category,
      withTimestamps: Boolean(withTimestamps),
      preferredProvider,
      overrides: overrides && typeof overrides === "object" ? overrides : undefined,
    });
    res.json(result);
  } catch (e) {
    console.error("[TTS] synthesize-category route error:", e);
    const message = String(e?.message || e);
    const status = /required|invalid|missing/i.test(message) ? 400 : 502;
    res.status(status).json({ ok: false, error: message });
  }
});

router.post("/edge", async (req, res) => {
  const { text, voiceId, rate, pitch, volume } = req.body || {};
  try {
    const result = await synthesizeEdgeTts({ text, voiceId, rate, pitch, volume });
    res.json(result);
  } catch (e) {
    console.error("[TTS] Edge route error:", e);
    const message = String(e?.message || e);
    const status = message.toLowerCase().includes("disabled") || message.toLowerCase().includes("required") ? 400 : 502;
    res.status(status).json({ ok: false, error: message });
  }
});

export default router;
