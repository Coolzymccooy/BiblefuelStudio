// Diagnostic: look up a user by email in both Firebase Auth and the local
// users.json store. Run from the server/ directory:
//
//   node scripts/check-user.js coolshegz@gmail.com
//
// Reports:
//   - Firebase: exists? providers? email verified? created when?
//   - Local store: exists? role? firebase-linked?

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getServiceAccount() {
  const projectId = String(process.env.FIREBASE_PROJECT_ID || "").trim();
  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || "").trim();
  const privateKey = String(process.env.FIREBASE_PRIVATE_KEY || "")
    .trim()
    .replace(/\\\\n/g, "\n")
    .replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey };
}

async function checkFirebase(email) {
  const sa = getServiceAccount();
  if (!sa) {
    console.log("Firebase Admin: NOT CONFIGURED (FIREBASE_* env vars missing).");
    return;
  }
  const app = getApps()[0] || initializeApp({ credential: cert(sa) });
  try {
    const u = await getAuth(app).getUserByEmail(email);
    const providers = (u.providerData || []).map((p) => p.providerId);
    console.log("Firebase Auth: FOUND");
    console.log("  uid:           ", u.uid);
    console.log("  email:         ", u.email);
    console.log("  emailVerified: ", u.emailVerified);
    console.log("  disabled:      ", u.disabled);
    console.log("  providers:     ", providers.join(", ") || "(none)");
    console.log("  hasPassword:   ", providers.includes("password"));
    console.log("  createdAt:     ", u.metadata.creationTime);
    console.log("  lastSignIn:    ", u.metadata.lastSignInTime || "(never)");
    if (!providers.includes("password")) {
      console.log("");
      console.log("  ⚠️  No password provider. This account was created via Google");
      console.log("      sign-in only. Email/password login will always fail.");
      console.log("      Sign in with 'Continue with Google' — OR use the reset");
      console.log("      flow, which lets Firebase add a password to the account.");
    }
  } catch (err) {
    if (err?.code === "auth/user-not-found") {
      console.log("Firebase Auth: NOT FOUND");
      console.log("  No Firebase user with this email exists.");
      console.log("  Sign up at /home or with Continue with Google.");
    } else {
      console.log("Firebase Auth: ERROR", err?.code || "", err?.message || err);
    }
  }
}

function checkLocal(email) {
  const usersPath = path.resolve(__dirname, "..", "data", "users.json");
  if (!fs.existsSync(usersPath)) {
    console.log("Local store: users.json missing.");
    return;
  }
  const raw = JSON.parse(fs.readFileSync(usersPath, "utf8"));
  const target = String(email || "").trim().toLowerCase();
  const hit = (raw.users || []).find((u) => String(u.email || "").trim().toLowerCase() === target);
  if (!hit) {
    console.log("Local store: NOT FOUND in data/users.json");
    console.log("  (Server hasn't recorded a sign-in for this email yet.)");
    return;
  }
  console.log("Local store: FOUND");
  console.log("  id:            ", hit.id);
  console.log("  role:          ", hit.role);
  console.log("  provider:      ", hit.provider);
  console.log("  emailVerified: ", hit.emailVerified);
  console.log("  firebaseUid:   ", hit.firebaseUid || "(none)");
  console.log("  hasPwdHash:    ", Boolean(hit.passwordHash));
  console.log("  createdAt:     ", hit.createdAt);
}

const email = String(process.argv[2] || "").trim();
if (!email) {
  console.error("Usage: node scripts/check-user.js <email>");
  process.exit(1);
}

console.log(`Looking up: ${email}\n`);
checkLocal(email);
console.log("");
await checkFirebase(email);
