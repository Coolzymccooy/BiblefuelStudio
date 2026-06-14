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
import socialRouter, { youtubeOauthCallback } from "./src/routes/social.js";
import firebaseRouter from "./src/routes/firebase.js";
import bibleRouter from "./src/routes/bible.js";
import seriesRouter from "./src/routes/series.js";
import transcribeRouter from "./src/routes/transcribe.js";
import transcriptsRouter from "./src/routes/transcripts.js";
import imagegenRouter from "./src/routes/imagegen.js";
import storyRouter from "./src/routes/story.js";
import musicRouter from "./src/routes/music.js";
import { requireAuth } from "./src/auth.js";
import { createAccessRequestsRouter } from "./src/routes/accessRequests.js";
import { getAccessRequestsStore } from "./src/lib/accessRequestsStore.js";
import { safeDownloadName } from "./src/lib/downloadName.js";
import { createEmailTransport } from "./services/email/transport.js";
import { sendEmail as sendEmailViaTransport } from "./services/email/send.js";
import { withUserScope } from "./src/middleware/userScope.js";
import { featureGate } from "./src/middleware/featureGate.js";
import { requireVerifiedEmail } from "./src/middleware/requireVerifiedEmail.js";
import { requireSuperAdmin } from "./src/middleware/requireSuperAdmin.js";
import { quota } from "./src/middleware/quota.js";
import billingRouter, { stripeWebhookHandler } from "./src/routes/billing.js";
import postizRouter from "./src/routes/postiz.js";
import { createAdminRouter } from "./src/routes/admin.js";
import issuesRouter from "./src/routes/issues.js";
import { DATA_DIR, OUTPUT_DIR } from "./src/lib/paths.js";
import { reconcilePersistedJobs } from "./src/lib/renderJobs.js";

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

// Media uploads (background clips, music, sermon audio) are sent as base64
// data URLs in the JSON body. Base64 inflates the payload ~1.37x, so a 200 MB
// file (the advertised MAX_UPLOAD_MB) arrives as ~270 MB of JSON. Cap at 300 MB
// so the UI's "Up to 200 MB" promise actually holds instead of 413-ing.
// NOTE: base64-in-JSON buffers the whole payload in memory — the real capacity
// fix is multipart streaming to disk; tracked as a follow-up.
app.use(express.json({ limit: "300mb" }));

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

// Always advertise byte-range support on /outputs/* responses. iOS Safari
// and QuickTime refuse to play MP4/MP3 without `Accept-Ranges: bytes` in the
// HEAD response — they fall back to the "play arrow with slash" broken icon.
//
// `no-transform` is critical: Cloudflare (and any intermediate reverse proxy
// e.g. Caddy/nginx) will otherwise gzip-encode the body for compressible
// content types, which forces `Transfer-Encoding: chunked` and silently
// strips Range-request support. The MP4 then arrives as a single 200 OK
// stream instead of a 206 partial, and iOS shows the broken-play icon.
// See: https://www.rfc-editor.org/rfc/rfc7234#section-5.2.1.6
// Cache-Control depends on whether the file needs byte-range playback.
//
// Video/audio MUST be range-served (esp. iOS Safari + QuickTime, which refuse
// to play without a 206 and show the broken-play icon). The origin honours
// Range correctly (res.sendFile / express.static both emit 206), but
// Cloudflare's shared cache stores these as chunked 200s and then answers
// Range requests with a full 200 — so iOS breaks while desktop/Android (which
// tolerate a plain 200) still play. Marking range-sensitive media `private`
// keeps Cloudflare's SHARED cache from storing them, so it proxies the request
// through and the origin's 206 reaches the device. Browsers still cache
// (private allows the local cache). Images don't need ranges, so they stay
// `public` and edge-cacheable.
function cacheControlForOutput(name) {
  const isRangeMedia = /\.(mp4|mov|webm|m4v|mp3|wav|m4a|aac|ogg)$/i.test(String(name || ""));
  return isRangeMedia
    ? "private, max-age=86400, no-transform"
    : "public, max-age=86400, no-transform";
}

// Force a real download when the client asks for it via ?dl=<filename>.
// Without Content-Disposition: attachment the browser serves the MP4/MP3
// inline — and iOS Safari (which ignores the HTML `download` attribute,
// especially cross-origin to the media subdomain) just OPENS AND PLAYS the
// video instead of saving it. The attachment header is the only reliable way
// to make "Download" actually save to Files/Photos on iOS. safeDownloadName
// sanitises the value to a single safe segment to prevent header injection.
app.use("/outputs", (req, res, next) => {
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", cacheControlForOutput(req.path));
  if (req.query && req.query.dl !== undefined) {
    const name = safeDownloadName(req.query.dl, decodeURIComponent(req.path));
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  }
  next();
});

app.use("/outputs", express.static(outputDir, {
  acceptRanges: true,
  setHeaders: (res, filePath) => {
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", cacheControlForOutput(filePath));
  },
}));

app.use("/music", express.static(path.resolve(__dirname, "assets/music"), { acceptRanges: true }));

// Per-user outputs fallback. With multi-tenant on, renders + processed audio
// land in DATA_DIR/users/<userId>/outputs/, NOT the global outputDir served
// above. Browsers play <video src="/outputs/foo.mp4"> with no auth headers,
// so we can't guard this with requireAuth — instead we rely on filenames
// being 128-bit UUIDs (effectively unguessable), the same model as Google
// Drive's unlisted-share links.
//
// Without this fallback, every per-user MP3/MP4/JPG hits the SPA catch-all
// and the browser receives HTML instead of media — the symptom users see is
// "0:00 audio" or "video won't play".
//
// In-memory cache (filename -> abs path) lets us serve hot files in O(1)
// after the first hit; we still O(users) scan on cache miss but UUID
// filenames mean lookups are unambiguous.
const perUserOutputCache = new Map();
const PER_USER_OUTPUT_CACHE_MAX = 2000;

function findInPerUserOutputs(filename) {
  const cached = perUserOutputCache.get(filename);
  if (cached && fs.existsSync(cached)) return cached;

  const usersRoot = path.join(DATA_DIR, "users");
  if (!fs.existsSync(usersRoot)) return null;
  let userIds;
  try {
    userIds = fs.readdirSync(usersRoot);
  } catch {
    return null;
  }
  for (const uid of userIds) {
    const candidate = path.join(usersRoot, uid, "outputs", filename);
    if (fs.existsSync(candidate)) {
      if (perUserOutputCache.size >= PER_USER_OUTPUT_CACHE_MAX) {
        // Drop oldest entry to bound memory.
        const firstKey = perUserOutputCache.keys().next().value;
        if (firstKey) perUserOutputCache.delete(firstKey);
      }
      perUserOutputCache.set(filename, candidate);
      return candidate;
    }
  }
  return null;
}

app.get("/outputs/:filename", (req, res, next) => {
  const raw = String(req.params.filename || "").trim();
  // Defence-in-depth — Express's :filename matcher already excludes "/" but
  // we still reject NUL, traversal segments, and absurd lengths to keep the
  // fallback narrow.
  if (!raw || raw.length > 256 || raw.includes("\0") || raw.includes("..") || raw.includes("/") || raw.includes("\\")) {
    return next();
  }
  const hit = findInPerUserOutputs(raw);
  if (hit) {
    // res.sendFile honours Range requests internally; Accept-Ranges header
    // was already set by the /outputs middleware above. We re-apply
    // Cache-Control here (with no-transform) because Express's sendFile
    // doesn't pass through .static options when called directly, and the
    // no-transform directive is what keeps Cloudflare/Caddy/nginx from
    // gzipping the response and breaking iOS Range requests.
    res.setHeader("Cache-Control", cacheControlForOutput(raw));
    res.setHeader("Accept-Ranges", "bytes");
    return res.sendFile(hit);
  }
  // Genuine miss: return a real 404 instead of letting the SPA catch-all
  // hand back text/html, which the browser then tries to play as video and
  // shows as "0:00" / "broken link". Audio/video tags handle 404 cleanly.
  return res.status(404).type("text/plain").send("output not found");
});

// --- Landing page: public access-request endpoint ---------------------------
// Mounted BEFORE any auth-guarded /api/* route so it stays publicly callable.
const emailTransport = createEmailTransport({
  apiKey: process.env.RESEND_API_KEY || '',
  from: process.env.MAIL_FROM || '',
  replyTo: process.env.MAIL_REPLY_TO || '',
});
const sendEmail = (req) => sendEmailViaTransport(emailTransport, req);
const accessRequestsStore = getAccessRequestsStore();
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

// Service worker + manifest MUST NOT be cached by intermediaries — iOS
// Chrome (and to a lesser extent Safari) will otherwise keep an old SW
// running indefinitely, which serves a stale precache of index.html that
// references chunk hashes that no longer exist on disk → blank white page
// on next deploy. By spec, browsers re-fetch sw.js on a 24h schedule
// regardless of Cache-Control, but Cloudflare/Caddy will happily serve the
// last cached copy for hours unless we tell them not to.
app.use(["/sw.js", "/registerSW.js", "/manifest.webmanifest"], (req, res, next) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  next();
});

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
app.use("/api/story",     requireAuth, withUserScope, requireVerifiedEmail, quota("render"),     storyRouter);
app.use("/api/pexels",    requireAuth, withUserScope, requireVerifiedEmail,                       pexelsRouter);
app.use("/api/pixabay",   requireAuth, withUserScope, requireVerifiedEmail,                       pixabayRouter);
app.use("/api/gumroad",   requireAuth, withUserScope, featureGate("gumroad"),                     gumroadRouter);
app.use("/api/media",     requireAuth, withUserScope,                                              mediaRouter);
app.use("/api/transcribe", requireAuth, withUserScope, requireVerifiedEmail, quota("render"),     transcribeRouter);
app.use("/api/transcripts", requireAuth, withUserScope, transcriptsRouter);
app.use("/api/imagegen",   requireAuth, withUserScope, requireVerifiedEmail, imagegenRouter);
app.use("/api/audio",     requireAuth, withUserScope, requireVerifiedEmail,                       audioRouter);
app.use("/api/audio-adv", requireAuth, withUserScope, requireVerifiedEmail,                       audioAdvancedRouter);
app.use("/api/library",   requireAuth, withUserScope,                                              libraryRouter);
app.use("/api/music",     requireAuth, withUserScope,                                              musicRouter);
// YouTube OAuth callback — Google redirects here after a user consents,
// arriving with no JWT (just ?code and ?state). Mount BEFORE the
// auth-gated /api/social router so it isn't blocked by requireAuth.
// The handler recovers the user from the signed `state` itself.
app.get("/api/social/youtube/callback", youtubeOauthCallback);
app.use("/api/social",    requireAuth, withUserScope, requireVerifiedEmail,                       socialRouter);
app.use("/api/firebase",  requireAuth, withUserScope,                                              firebaseRouter);
app.use("/api/bible",     requireAuth, withUserScope,                                              bibleRouter);
app.use("/api/series",    requireAuth, withUserScope, requireVerifiedEmail, quota("render"),     seriesRouter);
app.use("/api/postiz",    requireAuth, withUserScope, requireVerifiedEmail,                       postizRouter);
app.use("/api/issues",    requireAuth, withUserScope,                                              issuesRouter);
const publicSignupUrl = String(
  process.env.PUBLIC_BASE_URL ||
  process.env.APP_BASE_URL ||
  ''
).trim().replace(/\/+$/, '');
const adminSignupUrl = publicSignupUrl ? `${publicSignupUrl}/app` : 'https://biblefuel.tiwaton.co.uk/app';
app.use("/api/admin",     requireAuth, withUserScope, requireSuperAdmin,                          createAdminRouter({ accessRequestsStore, sendEmail, signupUrl: adminSignupUrl }));



// Fallback to serve the React app for client-side routing.
//
// CRITICAL: never serve index.html for asset-like requests. A stale client
// (an old service worker, or a CDN/browser-cached index.html) can request a
// chunk hash that a newer deploy already deleted. Returning index.html
// (HTTP 200, text/html) for that .js makes the browser's module loader
// hard-crash with a strict-MIME error → blank white page. Returning a real 404
// lets the SW's autoUpdate + reload (and the browser's normal error handling)
// recover cleanly. Only extensionless / non-/assets paths are real SPA routes.
const STATIC_ASSET_RE = /\.(js|mjs|css|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|eot|webmanifest|json|txt|wasm|mp4|webm|mp3|wav)$/i;
app.get('*', (req, res) => {
  if (req.path.startsWith('/assets/') || STATIC_ASSET_RE.test(req.path)) {
    return res.status(404).type('text/plain').send('Not found');
  }
  // index.html itself must always revalidate so a new deploy is picked up
  // immediately rather than from a stale browser/edge cache.
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
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

try {
  const interrupted = reconcilePersistedJobs(DATA_DIR);
  if (interrupted.length) console.warn(`[story] reconciled ${interrupted.length} interrupted render job(s)`);
} catch (e) {
  console.warn("[story] job reconciliation skipped:", e?.message || e);
}

app.listen(PORT, () => {
  console.log(`✅ Biblefuel Studio v2 running at http://localhost:${PORT}`);

  // Multi-tenancy posture diagnostics — surface the data-isolation mode
  // so operators don't accidentally ship in single-tenant where every
  // signed-in user reads the same global jobs.json / library.json.
  const mtFlag = String(process.env.MULTITENANT || "").toLowerCase().trim();
  const singleTenant = mtFlag === "false" || mtFlag === "0" || mtFlag === "off";
  if (singleTenant) {
    console.warn("⚠️  MULTITENANT=false — every signed-in user shares the global data dir. Public deploys MUST set MULTITENANT=true.");
  } else {
    const adminEmail = String(process.env.SUPER_ADMIN_EMAIL || "").trim();
    const adminId = String(process.env.SUPER_ADMIN_USER_ID || "").trim();
    if (!adminEmail && !adminId) {
      console.warn("⚠️  Multi-tenant mode is ON but neither SUPER_ADMIN_EMAIL nor SUPER_ADMIN_USER_ID is set. The original operator account will be treated as a regular user and will NOT see the legacy global library/jobs. Set SUPER_ADMIN_EMAIL in server/.env before signing in.");
    } else {
      console.log(`🔐 Multi-tenant: super-admin = ${adminEmail || adminId}; other users isolated under DATA_DIR/users/<id>/`);
    }
  }
});
