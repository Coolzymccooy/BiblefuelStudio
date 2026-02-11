import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

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
import { requireAuth } from "./src/auth.js";

// Load env from CURRENT server directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });
console.log(`📂 Loaded environment from: ${path.join(__dirname, '.env')}`);

const app = express();
app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json({ limit: "15mb" }));
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));

const outputDir = process.env.OUTPUT_DIR || path.join(__dirname, "outputs");
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

app.use("/outputs", express.static(outputDir));

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



// Fallback to serve React app for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("Unhandled Error:", err);
  res.status(500).json({
    ok: false,
    error: err.message || "Internal Server Error",
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

const PORT = Number(process.env.PORT || 5051);
app.listen(PORT, () => {
  console.log(`✅ Biblefuel Studio v2 running at http://localhost:${PORT}`);
});
