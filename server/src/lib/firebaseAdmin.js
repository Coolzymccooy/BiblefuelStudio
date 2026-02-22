import fs from "fs";
import path from "path";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";

function getPrivateKey() {
  const raw = String(process.env.FIREBASE_PRIVATE_KEY || "").trim();
  if (!raw) return "";
  return raw.replace(/\\n/g, "\n");
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

