import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";

function getPrivateKey() {
  const raw = String(process.env.FIREBASE_PRIVATE_KEY || "").trim();
  if (!raw) return "";
  return raw.replace(/\\\\n/g, "\n").replace(/\\n/g, "\n");
}

function getServiceAccount() {
  const projectId = String(process.env.FIREBASE_PROJECT_ID || "").trim();
  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || "").trim();
  const privateKey = getPrivateKey();
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey };
}

export function isFirebaseAdminEnabled() {
  return Boolean(getServiceAccount());
}

function getFirebaseApp() {
  const serviceAccount = getServiceAccount();
  if (!serviceAccount) return null;
  if (getApps().length > 0) return getApps()[0];

  const options = {
    credential: cert(serviceAccount),
  };
  const storageBucket = String(process.env.FIREBASE_STORAGE_BUCKET || "").trim();
  if (storageBucket) {
    options.storageBucket = storageBucket;
  }
  return initializeApp(options);
}

export async function verifyFirebaseIdToken(idToken) {
  const app = getFirebaseApp();
  if (!app) throw new Error("Firebase Admin not configured");
  return getAuth(app).verifyIdToken(String(idToken || "").trim());
}

/**
 * Look up a Firebase user by uid and return the live `emailVerified` flag.
 * The JWT/users.json copy is whatever was true at sign-in time; this hits
 * Firebase directly so a user who verified their email AFTER the last sign-in
 * can have their gate cleared without a sign-out/sign-in dance.
 *
 * Returns null if the uid isn't found or Firebase Admin isn't configured —
 * callers should treat null as "couldn't confirm" rather than "not verified".
 *
 * @param {string} uid
 * @returns {Promise<{ emailVerified: boolean, email?: string } | null>}
 */
export async function getFirebaseUserVerificationState(uid) {
  const app = getFirebaseApp();
  if (!app || !uid) return null;
  try {
    const user = await getAuth(app).getUser(String(uid));
    return { emailVerified: Boolean(user?.emailVerified), email: user?.email || "" };
  } catch (err) {
    console.warn("[FIREBASE] getUser failed for", uid, "—", err?.message || err);
    return null;
  }
}

export async function uploadLocalFileToFirebase(localPath, options = {}) {
  const app = getFirebaseApp();
  if (!app) throw new Error("Firebase Storage not configured");
  const bucket = getStorage(app).bucket();
  if (!bucket?.name) throw new Error("Firebase storage bucket not configured");

  const resolved = path.resolve(String(localPath || "").trim());
  if (!resolved || !fs.existsSync(resolved)) throw new Error(`File not found: ${localPath}`);

  const prefix = String(options.prefix || "outputs").replace(/^\/+|\/+$/g, "");
  const objectPath = `${prefix}/${Date.now()}-${path.basename(resolved)}`;
  await bucket.upload(resolved, { destination: objectPath });
  const file = bucket.file(objectPath);
  const [signedUrl] = await file.getSignedUrl({
    action: "read",
    expires: "2500-01-01",
  });

  return {
    bucket: bucket.name,
    objectPath,
    signedUrl,
    gsUrl: `gs://${bucket.name}/${objectPath}`,
  };
}

export async function mirrorOutputToFirebaseIfEnabled(localPath, options = {}) {
  const shouldMirror = String(process.env.FIREBASE_MIRROR_OUTPUTS || "").trim().toLowerCase() === "true";
  if (!shouldMirror || !isFirebaseAdminEnabled()) return null;
  try {
    return await uploadLocalFileToFirebase(localPath, options);
  } catch (err) {
    console.warn("[FIREBASE] Mirror failed:", err?.message || err);
    return null;
  }
}

// ── Resumable direct-to-GCS uploads ────────────────────────────────────────
// Large uploads (>90MB) can't go through the app origin: Cloudflare hard-caps
// request bodies at 100MB, and a one-shot POST can't survive a mobile drop.
// Instead the client uploads straight to GCS via a server-minted resumable
// session (authorised by the app's own JWT, not Firebase Auth), and the server
// pulls the finished object down to local disk so the render pipeline is
// unchanged. Every object lives under `uploads/<userId>/` so a user can only
// ever finalise their own upload.

const UPLOAD_PREFIX = "uploads";

function getStorageBucket() {
  const app = getFirebaseApp();
  if (!app) throw new Error("Firebase Storage not configured");
  const bucket = getStorage(app).bucket();
  if (!bucket?.name) throw new Error("Firebase storage bucket not configured");
  return bucket;
}

/** Sanitise a client filename to a single safe segment (no path, no traversal). */
function safeUploadName(filename) {
  const base = path.basename(String(filename || "").replace(/\\/g, "/")).trim();
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
  return cleaned.slice(0, 120) || "upload.bin";
}

// Normalise a user id to a single safe path segment. Dots are stripped (not
// just slashes) so a `sub` can never introduce a `..` into the object path.
function safeUserSegment(userId) {
  return String(userId || "").replace(/[^A-Za-z0-9_-]/g, "_");
}

/** The object path a given user is allowed to upload to. */
export function buildUserUploadPath(userId, filename) {
  const uid = safeUserSegment(userId);
  if (!uid) throw new Error("Missing user id for upload path");
  return `${UPLOAD_PREFIX}/${uid}/${uuid()}-${safeUploadName(filename)}`;
}

/** True only when objectPath is inside THIS user's own upload prefix. */
export function isOwnUploadPath(objectPath, userId) {
  const p = String(objectPath || "");
  const uid = safeUserSegment(userId);
  if (!p || !uid) return false;
  if (p.includes("..") || p.includes("\0") || p.length > 512) return false;
  return p.startsWith(`${UPLOAD_PREFIX}/${uid}/`);
}

/**
 * Mint a resumable upload session the browser PUTs chunks to directly.
 * Returns { sessionUrl, objectPath }. `origin` makes GCS emit CORS headers for
 * the app origin so the browser upload isn't blocked.
 */
export async function createResumableUploadSession({ userId, filename, contentType }) {
  const bucket = getStorageBucket();
  const objectPath = buildUserUploadPath(userId, filename);
  const origin = String(process.env.PUBLIC_BASE_URL || "").trim() || undefined;
  const [sessionUrl] = await bucket.file(objectPath).createResumableUpload({
    metadata: { contentType: String(contentType || "application/octet-stream") },
    ...(origin ? { origin } : {}),
  });
  return { sessionUrl, objectPath, bucket: bucket.name };
}

/** Object size in bytes (for a server-side cap re-check before download), or null. */
export async function getUploadObjectSize(objectPath) {
  try {
    const [meta] = await getStorageBucket().file(objectPath).getMetadata();
    const n = Number(meta?.size);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Download a finalized upload object to a local path, verifying integrity
 * (crc32c). Throws on checksum mismatch so corrupt transfers never reach the
 * pipeline. Ensures the destination directory exists.
 */
export async function downloadUploadToLocal(objectPath, destPath) {
  const bucket = getStorageBucket();
  const dir = path.dirname(destPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  await bucket.file(objectPath).download({ destination: destPath, validation: "crc32c" });
  return destPath;
}

/** Best-effort delete of an upload object (local copy is the source of truth). */
export async function deleteUploadObject(objectPath) {
  try {
    await getStorageBucket().file(objectPath).delete({ ignoreNotFound: true });
  } catch (err) {
    console.warn("[FIREBASE] deleteUploadObject failed:", err?.message || err);
  }
}

/**
 * Apply the CORS rule the browser→GCS resumable upload needs. Idempotent —
 * run once after deploy (or when the origin changes). Requires the service
 * account to have storage bucket admin.
 */
export async function ensureUploadCors(origins) {
  const bucket = getStorageBucket();
  const origin = (Array.isArray(origins) ? origins : [origins]).filter(Boolean);
  await bucket.setCorsConfiguration([
    {
      origin,
      method: ["GET", "PUT", "POST", "HEAD", "OPTIONS"],
      responseHeader: [
        "Content-Type",
        "Content-Range",
        "x-goog-resumable",
        "x-goog-content-length-range",
        "Range",
        "ETag",
      ],
      maxAgeSeconds: 3600,
    },
  ]);
  return { bucket: bucket.name, origin };
}

