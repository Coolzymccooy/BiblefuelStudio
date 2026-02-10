import { Router } from "express";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";

const router = Router();

router.post("/elevenlabs", async (req, res) => {
  try {
    const rawKey = (process.env.ELEVENLABS_API_KEY || "");
    const apiKey = rawKey.replace(/['"]/g, '').trim();
    const voiceId = process.env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL";

    if (!apiKey || apiKey.startsWith("your-")) {
      return res.status(400).json({ ok: false, error: "ELEVENLABS_API_KEY missing or invalid" });
    }

    console.log(`[TTS] Using ElevenLabs Key: ${apiKey.substring(0, 4)}... (Len: ${apiKey.length})`);

    const { text } = req.body || {};
    if (!text || String(text).trim().length < 3) return res.status(400).json({ ok: false, error: "text required" });

    const outDir = process.env.OUTPUT_DIR || "./outputs";
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const outFile = path.join(outDir, `tts-${uuid()}.mp3`);

    const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg"
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
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
