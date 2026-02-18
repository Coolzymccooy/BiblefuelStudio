import { Router } from "express";
import fetch, { File, FormData } from "node-fetch";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";

const router = Router();
const allowedAudioExt = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".webm"]);

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
    res.json({ ok: true, voices: data?.voices || [] });
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
  try {
    const apiKey = getElevenLabsApiKey();
    const defaultVoiceId = process.env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL";

    if (!apiKey || apiKey.startsWith("your-")) {
      return res.status(400).json({ ok: false, error: "ELEVENLABS_API_KEY missing or invalid" });
    }

    console.log(`[TTS] Using ElevenLabs Key: ${apiKey.substring(0, 4)}... (Len: ${apiKey.length})`);

    const { text, voiceId, voiceSettings, modelId } = req.body || {};
    if (!text || String(text).trim().length < 3) return res.status(400).json({ ok: false, error: "text required" });
    const resolvedVoiceId = String(voiceId || defaultVoiceId).trim();
    if (!resolvedVoiceId) return res.status(400).json({ ok: false, error: "voiceId missing" });

    const outDir = process.env.OUTPUT_DIR || "./outputs";
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const outFile = path.join(outDir, `tts-${uuid()}.mp3`);

    const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${resolvedVoiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg"
      },
      body: JSON.stringify({
        text,
        model_id: modelId || "eleven_multilingual_v2",
        voice_settings: {
          stability: voiceSettings?.stability ?? 0.5,
          similarity_boost: voiceSettings?.similarity_boost ?? 0.75
        }
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[TTS] ElevenLabs error: ${resp.status}`, errText);
      throw new Error(`ElevenLabs error: ${resp.status} ${errText}`);
    }

    const buffer = Buffer.from(await resp.arrayBuffer());
    fs.writeFileSync(outFile, buffer);
    console.log(`[TTS] MP3 saved to ${outFile}`);

    res.json({ ok: true, file: outFile });
  } catch (e) {
    console.error(`[TTS] Route error:`, e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default router;
