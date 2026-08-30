import { Router } from "express";
import fs from "fs";
import crypto from "crypto";
import { cleanSpeakableText } from "../lib/speakableScript.js";
import { synthesize } from "../lib/voice/index.js";

const router = Router();

/**
 * Constant-time secret comparison. A plain !== returns as soon as two bytes
 * differ, which leaks the secret a character at a time to anyone who can time
 * the response.
 */
function timingSafeEquals(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  // timingSafeEqual throws on a length mismatch, so compare a fixed-size
  // digest instead - equal length, and still constant time.
  const digestA = crypto.createHash('sha256').update(bufA).digest();
  const digestB = crypto.createHash('sha256').update(bufB).digest();
  return bufA.length > 0 && crypto.timingSafeEqual(digestA, digestB);
}

function abiProviderOrder() {
  return String(process.env.ABI_TTS_PROVIDER_CHAIN || "azure,edge,piper,fish,elevenlabs")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

router.get("/health", (_req, res) => {
  res.json({ ok: true, service: "abi-tts", providers: abiProviderOrder() });
});

router.post("/tts", async (req, res) => {
  // Fail CLOSED. This route is mounted without requireAuth or a quota, so it
  // is the shared secret alone that stands between the open internet and the
  // paid Azure / Fish / ElevenLabs quota. Treating "secret unset" as "allow
  // everyone" meant any deployment predating this variable - i.e. the one in
  // production right now - served unmetered TTS to anonymous callers.
  const sharedSecret = String(process.env.ABI_TTS_SHARED_SECRET || '').trim();
  if (!sharedSecret) {
    return res.status(503).json({
      ok: false,
      error: 'ABI_NOT_CONFIGURED',
      hint: 'Set ABI_TTS_SHARED_SECRET on the server to enable this endpoint.',
    });
  }
  const headerSecret = String(req.get('x-abi-secret') || '').trim();
  const bearer = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!timingSafeEquals(headerSecret, sharedSecret) && !timingSafeEquals(bearer, sharedSecret)) {
    return res.status(401).json({ ok: false, error: 'ABI_UNAUTHORIZED' });
  }
  const text = cleanSpeakableText(req.body?.text);
  if (!text || text.length < 3) {
    return res.status(400).json({ ok: false, error: "text required (min 3 chars)" });
  }

  const requestedVoiceId = String(req.body?.voiceId || "").trim();
  const failures = [];
  for (const provider of abiProviderOrder()) {
    try {
      const result = await synthesize({
        text,
        preferredProvider: provider,
        voiceIds: requestedVoiceId ? { [provider]: requestedVoiceId } : undefined,
        withTimestamps: false,
      });
      const file = result?.file;
      if (!file || !fs.existsSync(file)) throw new Error(`${provider} returned no readable audio file`);
      const bytes = fs.readFileSync(file);
      const isMp3 = String(file).toLowerCase().endsWith(".mp3");
      res.setHeader("Content-Type", isMp3 ? "audio/mpeg" : "audio/wav");
      res.setHeader("X-Abi-Provider", result.provider || provider);
      if (failures.length) res.setHeader("X-Abi-Fallbacks", failures.map((f) => `${f.provider}:${f.error}`).join(" | ").slice(0, 900));
      return res.send(bytes);
    } catch (err) {
      failures.push({ provider, error: String(err?.message || err) });
    }
  }
  return res.status(502).json({ ok: false, error: "Abi TTS providers failed", failures });
});

export default router;
