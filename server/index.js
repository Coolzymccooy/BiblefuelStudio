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
import firebaseRouter from "./src/routes/firebase.js";
import bibleRouter from "./src/routes/bible.js";
import seriesRouter from "./src/routes/series.js";
import { requireAuth } from "./src/auth.js";
import { createAccessRequestsRouter } from "./src/routes/accessRequests.js";
import { createAccessRequestsStore } from "./src/lib/accessRequestsStore.js";
import { createEmailTransport } from "./services/email/transport.js";
import { sendEmail as sendEmailViaTransport } from "./services/email/send.js";
import { DATA_DIR, OUTPUT_DIR } from "./src/lib/paths.js";

// Load env from CURRENT server directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });
const dataDir = DATA_DIR;
const outputDir = OUTPUT_DIR;
const jobsFile = path.join(dataDir, "jobs.json");
console.log(`[PATHS] DATA_DIR=${dataDir}`);
console.log(`[PATHS] OUTPUT_DIR=${outputDir}`);
console.log(`[PATHS] JOBS_FILE=${jobsFile}`);
console.log(`📂 Loaded environment from: ${path.join(__dirname, '.env')}`);

const app = express();
app.set("trust proxy", 1);
app.use(
  helmet({
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        // Allow audio/video from same origin, blob: (client-side objects) and any https: URL
        mediaSrc: ["'self'", "blob:", "https:"],
        connectSrc: ["'self'", "https:"],
        workerSrc: ["'self'", "blob:"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
  })
);
app.use(express.json({ limit: "100mb" }));
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));

if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

app.use("/outputs", express.static(outputDir));

// --- Landing page: public access-request endpoint ---------------------------
// Mounted BEFORE any auth-guarded /api/* route so it stays publicly callable.
const emailTransport = createEmailTransport({
  apiKey: process.env.RESEND_API_KEY || '',
  from: process.env.MAIL_FROM || '',
  replyTo: process.env.MAIL_REPLY_TO || '',
});
const sendEmail = (req) => sendEmailViaTransport(emailTransport, req);
const accessRequestsStore = createAccessRequestsStore({ dir: dataDir });
app.use('/api/access-requests', createAccessRequestsRouter({
  store: accessRequestsStore,
  sendEmail,
  notifyTo: process.env.ACCESS_REQUEST_NOTIFY_TO || process.env.MAIL_REPLY_TO || '',
}));

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
  const edgeEnabled = (process.env.EDGE_TTS_ENABLED ?? "true").toLowerCase() !== "false";
  const hasPexels = hasKey(process.env.PEXELS_API_KEY);
  const hasPixabay = hasKey(process.env.PIXABAY_API_KEY);

  const features = {
    scripts: hasOpenAI || hasGemini,
    // tts lights up if ANY provider is available — ElevenLabs (paid premium)
    // or Edge-TTS (free Microsoft neural). Voice cloning still requires
    // ElevenLabs specifically; see features.elevenlabs.
    tts: hasEleven || edgeEnabled,
    elevenlabs: hasEleven,
    edgeTts: edgeEnabled,
    pexels: hasPexels,
    pixabay: hasPixabay,
    render: ffmpegAvailable,
    audioProcessing: ffmpegAvailable,
  };

  const warnings = [];
  if (!features.scripts) warnings.push("Scripts: missing OPENAI_API_KEY or GEMINI_API_KEY");
  if (!features.tts) warnings.push("TTS: no provider available (need ELEVENLABS_API_KEY or EDGE_TTS_ENABLED)");
  if (!features.elevenlabs) warnings.push("ElevenLabs: missing ELEVENLABS_API_KEY (voice cloning + premium voices unavailable)");
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
app.use("/api/firebase", requireAuth, firebaseRouter);
app.use("/api/bible", requireAuth, bibleRouter);
app.use("/api/series", requireAuth, seriesRouter);



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
