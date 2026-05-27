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
import { withUserScope } from "./src/middleware/userScope.js";
import { featureGate } from "./src/middleware/featureGate.js";
import { requireVerifiedEmail } from "./src/middleware/requireVerifiedEmail.js";
import { quota } from "./src/middleware/quota.js";
import billingRouter, { stripeWebhookHandler } from "./src/routes/billing.js";
import postizRouter from "./src/routes/postiz.js";
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
// Stripe webhook MUST be mounted before express.json so the raw body is
// available for signature verification. The handler reads req.body as a
// Buffer and verifies via the official SDK.
app.post("/api/billing/webhook", express.raw({ type: "application/json" }), (req, res, next) => {
  stripeWebhookHandler(req, res).catch(next);
});

app.use(express.json({ limit: "100mb" }));

// CORS: when CORS_ORIGIN is set, treat it as a comma-separated allowlist and
// enable credentialed requests. Default to "*" only when explicitly unset (dev
// convenience). Public multi-tenant deploys MUST set CORS_ORIGIN to a real
// origin list to keep cookies/JWT-bearing requests safe.
const corsOrigin = process.env.CORS_ORIGIN;
app.use(cors({
  origin: corsOrigin && corsOrigin !== "*"
    ? corsOrigin.split(",").map((s) => s.trim()).filter(Boolean)
    : "*",
  credentials: !!corsOrigin && corsOrigin !== "*",
}));

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
app.use("/api/jobs", requireAuth, withUserScope, jobsRouter);

// Protected API routes — all use withUserScope (resolves req.ctx) and pass
// dataDir/outputDir down to the stores. featureGate is applied per route where
// non-default plans need to be blocked. See specs/2026-05-26-public-multitenancy-design.md.
// Billing — NOTE: webhook is mounted ABOVE express.json (see top of file).
app.use("/api/billing",   billingRouter);

// Phase 3 cost gates:
//   - requireVerifiedEmail: only enforced when REQUIRE_EMAIL_VERIFIED=true.
//     Mounted on expensive routes only (login + signup themselves aren't gated).
//   - quota(bucket): per-day per-user counter for free tier; premium/admin
//     are uncapped. Mount on routes that consume API budget or compute.
app.use("/api/scripts",   requireAuth, withUserScope, requireVerifiedEmail, quota("scripts"),    scriptsRouter);
app.use("/api/queue",     requireAuth, withUserScope,                                              queueRouter);
app.use("/api/tts",       requireAuth, withUserScope, requireVerifiedEmail, quota("tts"),        ttsRouter);
app.use("/api/render",    requireAuth, withUserScope, requireVerifiedEmail, quota("render"),     renderRouter);
app.use("/api/pexels",    requireAuth, withUserScope, requireVerifiedEmail,                       pexelsRouter);
app.use("/api/pixabay",   requireAuth, withUserScope, requireVerifiedEmail,                       pixabayRouter);
app.use("/api/gumroad",   requireAuth, withUserScope, featureGate("gumroad"),                     gumroadRouter);
app.use("/api/media",     requireAuth, withUserScope,                                              mediaRouter);
app.use("/api/audio",     requireAuth, withUserScope, requireVerifiedEmail,                       audioRouter);
app.use("/api/audio-adv", requireAuth, withUserScope, requireVerifiedEmail,                       audioAdvancedRouter);
app.use("/api/library",   requireAuth, withUserScope,                                              libraryRouter);
app.use("/api/social",    requireAuth, withUserScope, requireVerifiedEmail,                       socialRouter);
app.use("/api/firebase",  requireAuth, withUserScope,                                              firebaseRouter);
app.use("/api/bible",     requireAuth, withUserScope,                                              bibleRouter);
app.use("/api/series",    requireAuth, withUserScope, requireVerifiedEmail, quota("render"),     seriesRouter);
app.use("/api/postiz",    requireAuth, withUserScope, requireVerifiedEmail,                       postizRouter);



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
