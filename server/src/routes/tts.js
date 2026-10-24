import { Router } from "express";
import fetch, { File, FormData } from "node-fetch";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { synthesizeEdgeTts } from "../lib/edgeTts.js";
import { synthesizeElevenLabs } from "../lib/elevenLabsTts.js";
import { synthesizeTts } from "../lib/ttsOrchestrator.js";
import {
  PROFILES,
  listCategories,
  resolveProfile,
  synthesize,
  synthesizeForCategory,
  describeProviders,
  describeProvidersAsync,
  get as getVoiceProvider,
} from "../lib/voice/index.js";
import { listCaptionMotions, listKineticAnimations } from "../lib/videoFilters.js";
import { cleanSpeakableText } from "../lib/speakableScript.js";
import { listStudioLooks, ENERGIES } from "../lib/kinetic/looks.js";
import { hasLibass } from "../lib/kinetic/capability.js";
import {
  addChatterboxVoice,
  getChatterboxVoiceById,
  listChatterboxVoices,
  removeChatterboxVoice,
} from "../lib/chatterboxVoicesStore.js";
import { confineUserPath, isSharedTtsFile, sendUserPathError, UserPathError } from "../lib/userPathScope.js";
import { isOwnerCtx } from "../lib/paths.js";

// Edge synthesis behind a seam so route tests run without the network.
let _edgeTts = synthesizeEdgeTts;
/** Test-only. Pass null to restore the real Edge client. */
export function _setEdgeTtsImpl(fn) {
  _edgeTts = typeof fn === "function" ? fn : synthesizeEdgeTts;
}

const CHATTERBOX_CLONE_ID = /^cb:[\w-]+$/;
const INVALID_CHATTERBOX_VOICE =
  "A Chatterbox voice must be one of your saved clones (cb:<id>), or left empty for the default voice.";

/**
 * A voice addressed to Chatterbox: empty (the bridge's default voice) or a
 * saved-clone alias (`cb:<uuid>`) from the caller's own store, translated to
 * the reference path the bridge stored at /upload time. Anything else is
 * refused: the bridge opens the value as a file on its own host (#112).
 *
 * Ruling R36: the owner runs the bridge on their own machine, so the owner
 * alone may still name a reference file on it as free text. Other
 * super-admins are held to saved clones like everyone else.
 *
 * @returns {{ ok: true, voiceId: string } | { ok: false, status: number, error: string, message?: string }}
 */
function resolveChatterboxVoiceId(req, voiceId) {
  const raw = String(voiceId || "").trim();
  if (!raw) return { ok: true, voiceId: "" };
  if (!raw.startsWith("cb:") && isOwnerCtx(req?.ctx)) return { ok: true, voiceId: raw };
  if (!CHATTERBOX_CLONE_ID.test(raw)) {
    return { ok: false, status: 400, error: "INVALID_VOICE_ID", message: INVALID_CHATTERBOX_VOICE };
  }
  const dataDir = req?.ctx?.dataDir;
  if (!dataDir) return { ok: false, status: 500, error: "User scope unavailable" };
  const entry = getChatterboxVoiceById(dataDir, raw);
  if (!entry) return { ok: false, status: 404, error: "Cloned voice not found" };
  return { ok: true, voiceId: entry.refPath };
}

/** Answer a refused Chatterbox voice. */
function sendVoiceRefusal(res, resolved) {
  return res.status(resolved.status).json({
    ok: false,
    error: resolved.error,
    ...(resolved.message ? { message: resolved.message } : {}),
  });
}

/**
 * Category overrides with any Chatterbox voice resolved through the caller's
 * own clone store. Returns a new object; the request body is left alone.
 *
 * @returns {{ ok: true, overrides: object|undefined } | { ok: false, status: number, error: string, message?: string }}
 */
function resolveCategoryOverrides(req, overrides) {
  if (!overrides || typeof overrides !== "object") return { ok: true, overrides: undefined };
  const voiceIds = overrides.voiceIds && typeof overrides.voiceIds === "object" ? overrides.voiceIds : null;
  if (!voiceIds || voiceIds.chatterbox == null) return { ok: true, overrides };
  const resolved = resolveChatterboxVoiceId(req, voiceIds.chatterbox);
  if (!resolved.ok) return resolved;
  const { chatterbox: _dropped, ...rest } = voiceIds;
  const nextVoiceIds = resolved.voiceId ? { ...rest, chatterbox: resolved.voiceId } : rest;
  return { ok: true, overrides: { ...overrides, voiceIds: nextVoiceIds } };
}

// Supported voice-cloning providers. Azure (Custom Neural Voice / Personal
// Voice) needs a tenant-side activation we can't assume; Edge-TTS has no
// cloning API. The UI greys those out — the server rejects them defensively.
const CLONE_PROVIDERS = new Set(["elevenlabs", "chatterbox"]);

function getChatterboxBridgeUrl() {
  const raw = (process.env.CHATTERBOX_URL || "").trim();
  return raw.replace(/\/$/, "");
}

const router = Router();
const allowedAudioExt = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".webm"]);

const DEFAULT_EDGE_VOICE = "en-US-AriaNeural";
const EDGE_TTS_TIMEOUT_MS = 20_000;

// Phase 1 multi-tenancy: ElevenLabs (paid premium) is gated to super-admin
// and premium plans. Free users can use Edge-TTS and Chatterbox (self-hosted)
// without restriction. See specs/2026-05-26-public-multitenancy-design.md §3.
function elevenLabsAllowed(req) {
  const plan = req?.ctx?.plan;
  return plan === "super_admin" || plan === "premium";
}
function denyElevenLabs(req, res) {
  return res.status(403).json({
    ok: false,
    error: "FEATURE_LOCKED",
    capability: "tts.elevenlabs",
    plan: req?.ctx?.plan || "unknown",
    hint: "ElevenLabs is a premium feature. Use /api/tts/edge or /api/tts/chatterbox instead.",
  });
}
function voiceCloneAllowed(req) {
  const plan = req?.ctx?.plan;
  return plan === "super_admin" || plan === "premium";
}

// Fish Audio is a paid cloud provider (like ElevenLabs) — gated to the same
// premium/super-admin plans so free users can't burn Fish credits. Free users
// fall back to Edge-TTS / Chatterbox.
function fishAllowed(req) {
  const plan = req?.ctx?.plan;
  return plan === "super_admin" || plan === "premium";
}
function denyFish(req, res) {
  return res.status(403).json({
    ok: false,
    error: "FEATURE_LOCKED",
    capability: "tts.fish",
    plan: req?.ctx?.plan || "unknown",
    hint: "Fish Audio is a premium feature. Use /api/tts/edge or /api/tts/chatterbox instead.",
  });
}

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

/**
 * A clone sample: the caller's own file, or a shared tts-* voice file (#112).
 * Throws a UserPathError for anything else.
 */
function resolveSampleAudioPath(req, inputPath) {
  return confineUserPath(inputPath, req.ctx, { allowShared: isSharedTtsFile });
}

router.get("/voices", async (req, res) => {
  const provider = String(req.query?.provider || "elevenlabs").toLowerCase();

  if (provider === "elevenlabs" && !elevenLabsAllowed(req)) {
    return denyElevenLabs(req, res);
  }

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
  if (!voiceCloneAllowed(req)) {
    return res.status(403).json({
      ok: false,
      error: "FEATURE_LOCKED",
      capability: "voice.clone",
      plan: req?.ctx?.plan || "unknown",
      hint: "Voice cloning is a premium feature.",
    });
  }
  try {
    const rawProvider = String(req.body?.provider || "elevenlabs").toLowerCase().trim();
    if (rawProvider === "azure" || rawProvider === "edge" || rawProvider === "fish") {
      return res.status(400).json({
        ok: false,
        error: `Cloning is not available via ${rawProvider}.`,
        hint: rawProvider === "edge"
          ? "Edge-TTS only exposes stock voices."
          : rawProvider === "azure"
            ? "Azure cloning requires Custom Neural Voice or Personal Voice activation on your tenant."
            : "Fish Audio cloning is not wired in this app yet.",
      });
    }
    if (!CLONE_PROVIDERS.has(rawProvider)) {
      return res.status(400).json({ ok: false, error: `Unsupported clone provider: ${rawProvider}` });
    }

    // ---- Shared validation (name + samples + consent) ----
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
        error: "Consent required: confirm rights/permission, no impersonation, and provider terms."
      });
    }

    // Check every sample before reading any, so a refused one stops the clone.
    const resolvedSamples = [];
    for (const p of samplePaths) {
      try {
        resolvedSamples.push(resolveSampleAudioPath(req, p));
      } catch (err) {
        if (err instanceof UserPathError && err.code === "FILE_NOT_FOUND") {
          return res.status(400).json({ ok: false, error: `Sample file not found: ${p}` });
        }
        if (sendUserPathError(res, err)) return;
        throw err;
      }
    }

    const files = [];
    for (const [i, resolved] of resolvedSamples.entries()) {
      const p = samplePaths[i];
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

    // ---- Chatterbox branch ----
    if (rawProvider === "chatterbox") {
      const chatterboxUrl = getChatterboxBridgeUrl();
      if (!chatterboxUrl) {
        return res.status(400).json({
          ok: false,
          error: "CHATTERBOX_URL not configured. Point it at a Chatterbox bridge before cloning.",
        });
      }
      // Chatterbox conditions on a single reference WAV at synth time. If
      // the user uploaded multiple, the first wins; the response includes a
      // note so they're not surprised.
      const primary = files[0];
      const bytes = fs.readFileSync(primary.path);
      const form = new FormData();
      form.append("file", new File([bytes], primary.name, { type: primary.mime }));

      let resp;
      try {
        resp = await fetch(`${chatterboxUrl}/upload`, { method: "POST", body: form });
      } catch (err) {
        return res.status(502).json({
          ok: false,
          error: `Failed to reach Chatterbox bridge at ${chatterboxUrl}/upload: ${String(err?.message || err)}`,
        });
      }
      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        return res.status(resp.status === 413 ? 413 : 502).json({
          ok: false,
          error: `Chatterbox /upload failed: ${resp.status} ${errText.slice(0, 200)}`,
        });
      }
      const uploaded = await resp.json().catch(() => null);
      const refPath = uploaded?.path && String(uploaded.path).trim();
      if (!refPath) {
        return res.status(502).json({ ok: false, error: "Chatterbox /upload returned no path" });
      }

      const dataDir = req?.ctx?.dataDir;
      if (!dataDir) {
        return res.status(500).json({ ok: false, error: "User scope unavailable; cannot persist voice" });
      }
      const entry = await addChatterboxVoice(dataDir, {
        name,
        description,
        refPath,
        refFilename: uploaded?.filename || primary.name,
      });

      return res.json({
        ok: true,
        provider: "chatterbox",
        voiceId: entry.id,
        voice: entry,
        notes: files.length > 1
          ? `Chatterbox conditions on a single reference; used ${primary.name} (${files.length - 1} sample${files.length === 2 ? "" : "s"} ignored).`
          : undefined,
      });
    }

    // ---- ElevenLabs branch (default) ----
    const apiKey = getElevenLabsApiKey();
    if (!apiKey || apiKey.startsWith("your-")) {
      return res.status(400).json({ ok: false, error: "ELEVENLABS_API_KEY missing or invalid" });
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
      provider: "elevenlabs",
      voiceId: data?.voice_id || "",
      voice: data || null,
    });
  } catch (e) {
    console.error("[TTS] Clone route error:", e);
    const status = Number(e?.status || e?.statusCode || 500);
    res.status(Number.isFinite(status) ? status : 500).json({ ok: false, error: String(e?.message || e) });
  }
});

// List the Chatterbox cloned voices saved for the current user.
router.get("/chatterbox-voices", (req, res) => {
  const dataDir = req?.ctx?.dataDir;
  if (!dataDir) return res.status(500).json({ ok: false, error: "User scope unavailable" });
  // freeTextReference: may this account name a reference file on the bridge
  // host instead of a saved clone? The owner only (ruling R36).
  res.json({ ok: true, voices: listChatterboxVoices(dataDir), freeTextReference: isOwnerCtx(req.ctx) });
});

router.delete("/chatterbox-voices/:id", async (req, res) => {
  const dataDir = req?.ctx?.dataDir;
  if (!dataDir) return res.status(500).json({ ok: false, error: "User scope unavailable" });
  const id = String(req.params?.id || "").trim();
  if (!id.startsWith("cb:")) {
    return res.status(400).json({ ok: false, error: "Invalid Chatterbox voice id" });
  }
  const removed = await removeChatterboxVoice(dataDir, id);
  if (!removed) return res.status(404).json({ ok: false, error: "Voice not found" });
  res.json({ ok: true });
});

router.post("/elevenlabs", async (req, res) => {
  if (!elevenLabsAllowed(req)) return denyElevenLabs(req, res);
  const { voiceId, voiceSettings, modelId } = req.body || {};
  const text = cleanSpeakableText(req.body?.text);
  try {
    const result = await synthesizeElevenLabs({ text, voiceId, voiceSettings, modelId });
    res.json(result);
  } catch (e) {
    const message = String(e?.message || e);

    // ElevenLabs monthly free quota is small (~30k chars) and recoverable
    // by falling back to Edge-TTS — the user still gets audio, just from a
    // free provider. Other 4xx/5xx errors (bad key, voice not found,
    // upstream timeout) should surface so the operator notices.
    if (/quota_exceeded|quota exceeded/i.test(message)) {
      console.warn("[TTS] ElevenLabs quota exceeded — falling back to Edge-TTS");
      try {
        const fallback = await _edgeTts({ text, voiceId });
        return res.json({
          ...fallback,
          fallbackProvider: "edge",
          primaryProvider: "elevenlabs",
          primaryReason: "quota_exceeded",
          primaryError: message,
        });
      } catch (fallbackErr) {
        console.error("[TTS] Edge-TTS fallback after ElevenLabs quota failed:", fallbackErr);
        return res.status(502).json({
          ok: false,
          error: `ElevenLabs quota exceeded and Edge-TTS fallback failed: ${String(fallbackErr?.message || fallbackErr)}`,
        });
      }
    }

    console.error(`[TTS] ElevenLabs route error:`, e);
    const status = message.toLowerCase().includes("missing") || message.toLowerCase().includes("required") ? 400 : 502;
    res.status(status).json({ ok: false, error: message });
  }
});

const INPUT_ERROR = /required|invalid|missing|min 3 chars/i;

/**
 * A free plan's auto voice: Edge-TTS, and Azure when Edge fails and Azure is
 * configured (#120). Never ElevenLabs or Fish, which a free plan cannot use.
 * Azure gets the same voice name (Edge voices are Azure neural voices).
 */
async function synthesizeFreeAuto({ text, voiceId }) {
  try {
    return await _edgeTts({ text, voiceId });
  } catch (edgeErr) {
    const edgeMessage = String(edgeErr?.message || edgeErr);
    const azure = getVoiceProvider("azure");
    if (INPUT_ERROR.test(edgeMessage) || !azure?.isAvailable()) throw edgeErr;
    console.warn(`[TTS] free auto: Edge-TTS failed (${edgeMessage}), falling back to Azure`);
    try {
      const result = await azure.synthesize({ text, voiceId: voiceId || defaultEdgeVoice() });
      return { ...result, fallbackProvider: "azure", primaryProvider: "edge", primaryError: edgeMessage };
    } catch (azureErr) {
      throw new Error(`Edge-TTS failed: ${edgeMessage}. Azure fallback failed: ${String(azureErr?.message || azureErr)}`);
    }
  }
}

// Convenience route: ElevenLabs first, Edge-TTS automatic fallback.
// Free users hit /auto and get Edge-TTS directly (orchestrator's ElevenLabs
// branch is bypassed via the plan check), with Azure behind it when configured.
router.post("/auto", async (req, res) => {
  const { voiceId } = req.body || {};
  const text = cleanSpeakableText(req.body?.text);
  try {
    if (!elevenLabsAllowed(req)) {
      return res.json(await synthesizeFreeAuto({ text, voiceId }));
    }
    const result = await synthesizeTts({ text, voiceId });
    res.json(result);
  } catch (e) {
    console.error(`[TTS] auto route error:`, e);
    const message = String(e?.message || e);
    res.status(INPUT_ERROR.test(message) ? 400 : 502).json({ ok: false, error: message });
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

// Two modes:
//   default       — fast: env-only check (every provider's isAvailable()),
//                   no network. Existing UI behavior unchanged.
//   ?probe=1      — async: also awaits each provider's optional
//                   isReachable() so a self-hosted bridge that's
//                   temporarily offline shows as configured-but-unreachable.
//                   Costs an extra ~5s when chatterbox can't be reached
//                   (probe timeout); cached for ~30s thereafter.
router.get("/providers", async (req, res) => {
  const wantsProbe = String(req.query?.probe || "").toLowerCase() === "1"
    || String(req.query?.probe || "").toLowerCase() === "true";
  if (!wantsProbe) {
    return res.json({ ok: true, providers: describeProviders() });
  }
  try {
    const providers = await describeProvidersAsync();
    return res.json({ ok: true, providers, probed: true });
  } catch (e) {
    console.warn("[TTS] /providers async probe failed:", e?.message || e);
    // Fall back to the sync answer so the UI still has something to render.
    return res.json({ ok: true, providers: describeProviders(), probed: false, probeError: String(e?.message || e) });
  }
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

// Kinetic caption animation catalog (ported from lumina-presenter). Read-only;
// powers the animation picker. `renderable` flags which entries fully render in
// the ffmpeg pipeline vs. degrade (browser-only effects listed in `unsupported`).
router.get("/animations", (_req, res) => {
  // `motions` ships alongside the styles so the picker cannot offer a timing
  // the renderer does not implement - one list, both ends.
  res.json({
    ok: true,
    animations: listKineticAnimations(),
    motions: listCaptionMotions(),
    // Studio looks (libass) are a separate list: each picker shows them once
    // its renderer can draw them, instead of silently getting a fallback.
    studioLooks: listStudioLooks(),
    energies: ENERGIES,
    libass: hasLibass(),
  });
});

router.post("/synthesize-category", async (req, res) => {
  const { category, withTimestamps, preferredProvider } = req.body || {};
  const text = cleanSpeakableText(req.body?.text);
  const scoped = resolveCategoryOverrides(req, req.body?.overrides);
  if (!scoped.ok) return sendVoiceRefusal(res, scoped);
  const { overrides } = scoped;
  try {
    if (String(preferredProvider || "").toLowerCase() === "elevenlabs" && !elevenLabsAllowed(req)) {
      return denyElevenLabs(req, res);
    }
    // Free users have ElevenLabs masked from the orchestrator's preference
    // chain so categories that prefer ElevenLabs silently downgrade to Edge.
    const effectivePreferred = elevenLabsAllowed(req)
      ? preferredProvider
      : (String(preferredProvider || "").toLowerCase() === "elevenlabs" ? "edge" : preferredProvider);
    const result = await synthesizeForCategory({
      text,
      category,
      withTimestamps: Boolean(withTimestamps),
      preferredProvider: effectivePreferred,
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
  const { voiceId, rate, pitch, volume } = req.body || {};
  const text = cleanSpeakableText(req.body?.text);
  try {
    const result = await _edgeTts({ text, voiceId, rate, pitch, volume });
    res.json(result);
  } catch (e) {
    console.error("[TTS] Edge route error:", e);
    const message = String(e?.message || e);
    const status = message.toLowerCase().includes("disabled") || message.toLowerCase().includes("required") ? 400 : 502;
    res.status(status).json({ ok: false, error: message });
  }
});

// Direct Chatterbox route — mirrors the /edge and /elevenlabs shape so the
// existing VoiceAudioPage can pick a provider without going through the
// category/profile system. Forces preferredProvider:"chatterbox" so the
// orchestrator routes there directly. The orchestrator already chains
// through other providers if chatterbox throws, but operators have hit
// edge cases (every provider failing in lockstep, schema errors at the
// boundary) where the chain gives up before reaching Edge-TTS. As a
// belt-and-braces, we catch any orchestrator failure here and call
// Edge-TTS directly — the user always gets audio out, with a
// `fallbackProvider` field flagging what really happened so the toast
// can show "delivered via Edge-TTS — Chatterbox was offline" instead of
// a raw pipeline error.
router.post("/chatterbox", async (req, res) => {
  const { voiceId, exaggeration, cfgWeight } = req.body || {};
  const text = cleanSpeakableText(req.body?.text);
  // Resolve `cb:<uuid>` aliases to the bridge-side reference path before
  // handing off to the orchestrator/provider.
  const resolved = resolveChatterboxVoiceId(req, voiceId);
  if (!resolved.ok) return sendVoiceRefusal(res, resolved);
  const effectiveVoiceId = resolved.voiceId;
  try {
    const voiceSettings = {};
    if (typeof exaggeration === "number") voiceSettings.style = exaggeration;
    if (typeof cfgWeight === "number") voiceSettings.cfg_weight = cfgWeight;

    const result = await synthesizeForCategory({
      text,
      category: "devotional",
      preferredProvider: "chatterbox",
      overrides: {
        voiceIds: effectiveVoiceId ? { chatterbox: effectiveVoiceId } : undefined,
        voiceSettings: Object.keys(voiceSettings).length > 0 ? voiceSettings : undefined,
        forcedAlignmentFallback: false,
      },
    });
    return res.json(result);
  } catch (e) {
    const message = String(e?.message || e);
    console.warn("[TTS] Chatterbox pipeline failed, attempting Edge-TTS fallback:", message);

    // 400-class errors (bad input — text too short, missing field) shouldn't
    // be silently masked by Edge-TTS; surface them as-is.
    if (/required|invalid|missing/i.test(message) && !/chatterbox/i.test(message)) {
      return res.status(400).json({ ok: false, error: message });
    }

    try {
      const fallback = await _edgeTts({ text });
      return res.json({
        ...fallback,
        fallbackProvider: "edge",
        primaryProvider: "chatterbox",
        primaryError: message,
      });
    } catch (fallbackErr) {
      console.error("[TTS] Edge-TTS fallback also failed:", fallbackErr);
      return res.status(502).json({
        ok: false,
        error: `Both Chatterbox and Edge-TTS failed. Chatterbox: ${message}. Edge-TTS: ${String(fallbackErr?.message || fallbackErr)}`,
      });
    }
  }
});

// Fish Audio route — premium cloud provider, mirrors the /elevenlabs and
// /chatterbox shape. Forces preferredProvider:"fish" so the orchestrator tries
// Fish first; if Fish is down it transparently chains through the remaining
// available providers (the result.provider field reports what actually ran).
// `speed` (0.5–2.0) maps to Fish's prosody.speed via voiceSettings.
router.post("/fish", async (req, res) => {
  if (!fishAllowed(req)) return denyFish(req, res);

  const { voiceId, voiceSettings, modelId, speed, withTimestamps } = req.body || {};
  const text = cleanSpeakableText(req.body?.text);
  try {
    const mergedSettings = { ...(voiceSettings && typeof voiceSettings === "object" ? voiceSettings : {}) };
    if (typeof speed === "number") mergedSettings.speed = speed;

    const result = await synthesize({
      text,
      voiceIds: voiceId ? { fish: voiceId } : undefined,
      voiceSettings: Object.keys(mergedSettings).length > 0 ? mergedSettings : undefined,
      modelId,
      preferredProvider: "fish",
      withTimestamps: Boolean(withTimestamps),
    });
    return res.json(result);
  } catch (e) {
    console.error("[TTS] Fish route error:", e);
    const message = String(e?.message || e);
    const status = /required|invalid|missing|min 3 chars/i.test(message) ? 400 : 502;
    return res.status(status).json({ ok: false, error: message });
  }
});

// Azure Speech route — the primary kinetic-caption / word-timestamp provider.
// Production-safe commercial usage; not premium-gated (it's the caption engine)
// — abuse is bounded by the shared quota("tts") gate on /api/tts. Forces
// preferredProvider:"azure". Pass withTimestamps:true to get the normalized
// word-alignment contract back in result.words for kinetic typography.
router.post("/azure", async (req, res) => {
  const { voiceId, withTimestamps } = req.body || {};
  const text = cleanSpeakableText(req.body?.text);
  try {
    const result = await synthesize({
      text,
      voiceIds: voiceId ? { azure: voiceId } : undefined,
      preferredProvider: "azure",
      withTimestamps: withTimestamps === undefined ? true : Boolean(withTimestamps),
    });
    return res.json(result);
  } catch (e) {
    console.error("[TTS] Azure route error:", e);
    const message = String(e?.message || e);
    const status = /required|invalid|missing|min 3 chars/i.test(message) ? 400 : 502;
    return res.status(status).json({ ok: false, error: message });
  }
});

// Piper route — free local fallback (rhasspy/piper). Ungated: it costs
// nothing and runs on the operator's own machine via a small HTTP wrapper
// (PIPER_URL). Bare TTS — no native timestamps; caption sync falls back to
// the orchestrator's forced-alignment pass when withTimestamps is true.
// See docs/PIPER_SETUP.md.
router.post("/piper", async (req, res) => {
  const { voiceId, withTimestamps } = req.body || {};
  const text = cleanSpeakableText(req.body?.text);
  try {
    const result = await synthesize({
      text,
      voiceIds: voiceId ? { piper: voiceId } : undefined,
      preferredProvider: "piper",
      withTimestamps: Boolean(withTimestamps),
    });
    return res.json(result);
  } catch (e) {
    console.error("[TTS] Piper route error:", e);
    const message = String(e?.message || e);
    const status = /required|invalid|missing|min 3 chars|PIPER_URL/i.test(message) ? 400 : 502;
    return res.status(status).json({ ok: false, error: message });
  }
});

// ──────────────────────────────────────────────────────────────────────────
// POST /api/tts/compare — Voice Lab side-by-side compare.
//
// Synthesises the same text across 2–4 candidate providers in parallel so
// the UI can play them back-to-back and rate them. Each candidate is run
// through the existing voice/index synthesize() orchestrator with
// preferredProvider forced — same code path the per-provider routes use.
//
// Per-candidate failures do NOT fail the whole request: each task catches
// its own error and returns a {status:'error', error} result, so a slow
// or down provider can't poison an A/B against the others.
//
// Premium gating (fish, elevenlabs) is applied per-candidate up-front —
// free-plan callers get those entries marked forbidden while non-premium
// candidates (azure/edge/chatterbox) still synthesise normally.
//
// Test seam: the synthesise function is read from _compareSynthImpl so
// route tests can inject a fake without exercising real providers / keys.
// ──────────────────────────────────────────────────────────────────────────
const COMPARE_MAX_CANDIDATES = 4;
const COMPARE_PREMIUM_PROVIDERS = new Set(["fish", "elevenlabs"]);

let _compareSynthImpl = synthesize;
export function _setCompareSynthImpl(fn) {
  _compareSynthImpl = typeof fn === "function" ? fn : synthesize;
}

router.post("/compare", async (req, res) => {
  const { candidates, withTimestamps } = req.body || {};
  const text = cleanSpeakableText(req.body?.text);

  if (typeof text !== "string" || text.trim().length === 0) {
    return res.status(400).json({ ok: false, error: "text is required" });
  }
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return res.status(400).json({ ok: false, error: "candidates (1-4) is required" });
  }
  if (candidates.length > COMPARE_MAX_CANDIDATES) {
    return res.status(400).json({ ok: false, error: `at most ${COMPARE_MAX_CANDIDATES} candidates` });
  }
  for (const c of candidates) {
    if (!c || typeof c.provider !== "string" || c.provider.trim() === "") {
      return res.status(400).json({ ok: false, error: "each candidate must specify a provider" });
    }
  }

  const plan = req?.ctx?.plan;
  const hasPremium = plan === "premium" || plan === "super_admin";

  const tasks = candidates.map(async (c, idx) => {
    const id = `${idx}-${c.provider}`;
    const t0 = Date.now();
    try {
      if (COMPARE_PREMIUM_PROVIDERS.has(c.provider) && !hasPremium) {
        return {
          id,
          provider: c.provider,
          voiceId: c.voiceId,
          label: c.label,
          status: "error",
          error: `${c.provider} is a premium feature (forbidden on plan "${plan || "unknown"}")`,
          latencyMs: 0,
        };
      }
      // A Chatterbox voice is a file on the bridge host: only a saved clone.
      let voiceId = c.voiceId;
      if (c.provider === "chatterbox") {
        const resolved = resolveChatterboxVoiceId(req, voiceId);
        if (!resolved.ok) {
          return {
            id, provider: c.provider, voiceId: c.voiceId, label: c.label, status: "error",
            error: resolved.message || resolved.error, latencyMs: 0,
          };
        }
        voiceId = resolved.voiceId;
      }
      const result = await _compareSynthImpl({
        text,
        voiceIds: voiceId ? { [c.provider]: voiceId } : undefined,
        preferredProvider: c.provider,
        withTimestamps: withTimestamps === undefined ? true : Boolean(withTimestamps),
      });
      return {
        id,
        provider: c.provider,
        voiceId: c.voiceId,
        label: c.label,
        status: "ok",
        file: result.file,
        voice: result.voice,
        words: result.words,
        latencyMs: Date.now() - t0,
      };
    } catch (e) {
      return {
        id,
        provider: c.provider,
        voiceId: c.voiceId,
        label: c.label,
        status: "error",
        error: String(e?.message || e),
        latencyMs: Date.now() - t0,
      };
    }
  });

  const results = await Promise.all(tasks);
  // Nothing was synthesized, so the tts unit this call spent comes back (#120).
  if (results.every((r) => r.status !== "ok")) res.locals.refundQuota?.();
  return res.json({ ok: true, results });
});

export default router;
