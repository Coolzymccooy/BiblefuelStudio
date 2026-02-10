import fetch from "node-fetch";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

async function test() {
    const apiKey = (process.env.ELEVENLABS_API_KEY || "").replace(/['"]/g, '').trim();
    const voiceId = process.env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL";

    console.log(`Testing ElevenLabs with key: ${apiKey.substring(0, 5)}...`);
    console.log(`Using Voice ID: ${voiceId}`);

    try {
        const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
            method: "POST",
            headers: {
                "xi-api-key": apiKey,
                "Content-Type": "application/json",
                "Accept": "audio/mpeg"
            },
            body: JSON.stringify({
                text: "Hello, this is a test from Biblefuel Studio.",
                model_id: "eleven_multilingual_v2",
                voice_settings: { stability: 0.5, similarity_boost: 0.75 }
            })
        });

        if (!resp.ok) {
            const err = await resp.text();
            console.error(`❌ ElevenLabs API Error (${resp.status}): ${err}`);
        } else {
            console.log("✅ Success! ElevenLabs returned 200 OK.");
        }
    } catch (err) {
        console.error("❌ Fetch Error:", err);
    }
}

test();
