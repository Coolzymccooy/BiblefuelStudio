import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

import scriptsRouter from "./src/routes/scripts.js";
import queueRouter from "./src/routes/queue.js";
import ttsRouter from "./src/routes/tts.js";
import renderRouter from "./src/routes/render.js";
import pexelsRouter from "./src/routes/pexels.js";
import pixabayRouter from "./src/routes/pixabay.js";
import gumroadRouter from "./src/routes/gumroad.js";
import mediaRouter from "./src/routes/media.js";
import audioRouter from "./src/routes/audio.js";
import audioAdvancedRouter from "./src/routes/audio_advanced.js";
import authRouter from "./src/routes/auth.js";
import jobsRouter from "./src/routes/jobs.js";
import libraryRouter from "./src/routes/library.js";
import socialRouter from "./src/routes/social.js";
import { requireAuth } from "./src/auth.js";

// Load env from CURRENT server directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });
console.log(`📂 Loaded environment from: ${path.join(__dirname, '.env')}`);

const app = express();
app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json({ limit: "100mb" }));
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));

const outputDir = process.env.OUTPUT_DIR || path.join(__dirname, "outputs");
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

app.use("/outputs", express.static(outputDir));

const hasKey = (value) => {
  const v = String(value || "").trim();
  return v.length > 0 && !v.startsWith("your-");
};

const checkFfmpegAvailable = () => {
  const ffmpegRaw = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  try {
    execSync(`${ffmpegRaw} -version`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

const ffmpegAvailable = checkFfmpegAvailable();

app.get('/api/health', async (req, res) => {
  const ffmpegRaw = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  // Simple check for ffmpeg availability
  const { execSync } = await import('child_process');
  let ffmpegVersion = "unknown";
  try {
    if (execSync) {
      ffmpegVersion = execSync(`${ffmpegRaw} -version`).toString().split('\n')[0];
    }
  } catch (e) { }

  res.json({
    ok: true,
    ts: new Date().toISOString(),
    system: {
      ffmpeg: ffmpegVersion,
      platform: process.platform,
      node: process.version
    }
  });
});

app.get('/api/config', (req, res) => {
  const hasOpenAI = hasKey(process.env.OPENAI_API_KEY);
  const hasGemini = hasKey(process.env.GEMINI_API_KEY);
  const hasEleven = hasKey(process.env.ELEVENLABS_API_KEY);
  const hasPexels = hasKey(process.env.PEXELS_API_KEY);
  const hasPixabay = hasKey(process.env.PIXABAY_API_KEY);

  const features = {
    scripts: hasOpenAI || hasGemini,
    tts: hasEleven,
    pexels: hasPexels,
    pixabay: hasPixabay,
    render: ffmpegAvailable,
    audioProcessing: ffmpegAvailable,
  };

  const warnings = [];
  if (!features.scripts) warnings.push("Scripts: missing OPENAI_API_KEY or GEMINI_API_KEY");
  if (!features.tts) warnings.push("TTS: missing ELEVENLABS_API_KEY");
  if (!features.pexels) warnings.push("Pexels: missing PEXELS_API_KEY");
  if (!features.pixabay) warnings.push("Pixabay: missing PIXABAY_API_KEY");
  if (!features.render) warnings.push("FFmpeg not detected; render/audio tools disabled");

  res.json({
    ok: true,
    env: process.env.NODE_ENV || "development",
    features,
    warnings,
  });
});

const publicDir = path.join(__dirname, "public");
app.use("/", express.static(publicDir));

app.use("/api/auth", authRouter);
app.use("/api/jobs", requireAuth, jobsRouter);

// Protected API routes
app.use("/api/scripts", requireAuth, scriptsRouter);
app.use("/api/queue", requireAuth, queueRouter);
app.use("/api/tts", requireAuth, ttsRouter);
app.use("/api/render", requireAuth, renderRouter);
app.use("/api/pexels", requireAuth, pexelsRouter);
app.use("/api/pixabay", requireAuth, pixabayRouter);
app.use("/api/gumroad", requireAuth, gumroadRouter);
app.use("/api/media", requireAuth, mediaRouter);
app.use("/api/audio", requireAuth, audioRouter);
app.use("/api/audio-adv", requireAuth, audioAdvancedRouter);
app.use("/api/library", requireAuth, libraryRouter);
app.use("/api/social", requireAuth, socialRouter);



// Fallback to serve React app for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("Unhandled Error:", err);
  const status = Number(err?.status || err?.statusCode || 500);
  res.status(Number.isFinite(status) ? status : 500).json({
    ok: false,
    error: err.message || "Internal Server Error",
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

const PORT = Number(process.env.PORT || 5051);
app.listen(PORT, () => {
  console.log(`✅ Biblefuel Studio v2 running at http://localhost:${PORT}`);
});
