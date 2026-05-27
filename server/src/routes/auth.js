import { Router } from "express";
import fs from "fs";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { hasAnyUser, createOwner, verifyUser, signToken, requireAuth, upsertFirebaseUser, deleteUserById, getUsersStore } from "../auth.js";
import { isFirebaseAdminEnabled, verifyFirebaseIdToken } from "../lib/firebaseAdmin.js";
import { writeUserPlan } from "../lib/userPlanStore.js";
import { dataDirFor, ensureUserDirs } from "../lib/paths.js";
import { isSuperAdmin } from "../lib/userPlan.js";

const router = Router();

// Limit only the credential-bearing POST endpoints. /status and /me are
// polled on every page load — including them in the limiter caused users
// to see spurious 429s on first sign-in.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  standardHeaders: "draft-7",
  legacyHeaders: false
});

router.get("/status", (req, res) => {
  // Phase 2: signup is OPEN. The legacy "first user does setup" path is kept
  // for the operator's existing super-admin account, but new visitors land on
  // the signup form regardless of hasUser.
  res.json({
    ok: true,
    hasUser: hasAnyUser(),
    firebaseEnabled: isFirebaseAdminEnabled(),
    publicSignup: true,
    requireEmailVerified: String(process.env.REQUIRE_EMAIL_VERIFIED || "").toLowerCase() === "true",
  });
});

router.get("/me", requireAuth, (req, res) => {
  // The JWT bakes in `emailVerified` at sign-in time, so a user who logs in
  // before verifying their email gets a stale `false` even after clicking
  // the verify link. Enrich from the live users.json so the verify-gate
  // unblocks as soon as the user is marked verified server-side, without
  // requiring a sign-out/sign-in dance.
  const claims = req.user || {};
  try {
    const store = getUsersStore();
    const uid = String(claims.sub || "").trim();
    const email = String(claims.email || "").trim().toLowerCase();
    const live = (store.users || []).find((u) =>
      String(u?.id || "") === uid ||
      String(u?.email || "").toLowerCase() === email
    );
    if (live) {
      return res.json({
        ok: true,
        user: {
          ...claims,
          email: live.email || claims.email,
          role: live.role || claims.role,
          emailVerified: Boolean(live.emailVerified),
        },
      });
    }
  } catch (err) {
    // Fall through to claims-only response on store read failure.
    console.warn("[AUTH] /me enrichment failed:", err?.message || err);
  }
  res.json({ ok: true, user: claims });
});

router.post("/setup", authLimiter, async (req, res) => {
  try {
    const setupKey = String(process.env.ADMIN_SETUP_KEY || "").trim();
    if (!setupKey) return res.status(400).json({ ok: false, error: "ADMIN_SETUP_KEY not set on server" });
    if (String(req.headers["x-setup-key"] || "") !== setupKey) {
      return res.status(401).json({ ok: false, error: "Invalid setup key" });
    }
    if (hasAnyUser()) return res.status(400).json({ ok: false, error: "Setup already completed" });

    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(8).max(128)
    });

    const body = schema.parse(req.body || {});
    const user = await createOwner(body.email, body.password);
    const token = signToken(user);
    res.json({ ok: true, user, token });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

router.post("/login", authLimiter, async (req, res) => {
  try {
    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(1).max(128)
    });
    const body = schema.parse(req.body || {});
    const user = await verifyUser(body.email, body.password);
    if (!user) return res.status(401).json({ ok: false, error: "Invalid credentials" });
    const token = signToken(user);
    res.json({ ok: true, user, token });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

router.post("/firebase", authLimiter, async (req, res) => {
  try {
    if (!isFirebaseAdminEnabled()) {
      return res.status(400).json({ ok: false, error: "Firebase auth not configured on server" });
    }
    const idToken = String(req.body?.idToken || "").trim();
    if (!idToken) return res.status(400).json({ ok: false, error: "idToken required" });

    const decoded = await verifyFirebaseIdToken(idToken);
    const user = upsertFirebaseUser(decoded);

    // Bootstrap the per-user dir + plan record on first sign-in. Super-admin
    // continues to read/write the legacy global files (see withUserScope).
    if (!isSuperAdmin({ sub: user.id, email: user.email })) {
      try {
        ensureUserDirs({ sub: user.id, email: user.email });
        const userDir = dataDirFor({ sub: user.id, email: user.email });
        // Idempotent: writeUserPlan merges over the existing record.
        writeUserPlan(userDir, { plan: "free", status: "active" });
      } catch (initErr) {
        console.warn("[AUTH] Failed to bootstrap user dir/plan:", initErr?.message || initErr);
        // Don't block sign-in on bootstrap failure — middleware will recreate
        // on the next request.
      }
    }

    const token = signToken(user);
    res.json({ ok: true, user, token });
  } catch (e) {
    res.status(401).json({ ok: false, error: String(e?.message || e) });
  }
});

router.delete("/me", requireAuth, (req, res) => {
  // Account deletion: removes the user record and their per-user data dir.
  // Firebase account itself is NOT deleted from here — the client should
  // separately call firebase.auth().currentUser.delete() so the Firebase
  // record disappears too. (Doing both atomically requires Admin SDK ops
  // that need elevated perms — kept out of scope to avoid coupling.)
  try {
    const userId = String(req.user?.sub || "").trim();
    if (!userId) return res.status(400).json({ ok: false, error: "User context missing" });

    // Don't allow super-admin to delete themselves through this endpoint.
    if (isSuperAdmin(req.user)) {
      return res.status(400).json({ ok: false, error: "Super-admin account cannot be self-deleted via this endpoint" });
    }

    // Remove the per-user data dir (best-effort).
    try {
      const userDir = dataDirFor({ sub: userId, email: req.user.email || "" });
      if (fs.existsSync(userDir)) {
        fs.rmSync(userDir, { recursive: true, force: true });
      }
    } catch (rmErr) {
      console.warn("[AUTH] Failed to remove user dir:", rmErr?.message || rmErr);
    }

    const removed = deleteUserById(userId);
    if (!removed) return res.status(404).json({ ok: false, error: "User not found" });

    res.json({ ok: true, deleted: userId });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e?.message || e) });
  }
});

router.post("/forgot-password", authLimiter, (req, res) => {
  // In a real app, integrate with SendGrid/Mailgun here
  // For now, checks if user exists and logs the reset request
  const { email } = req.body;
  console.log(`[AUTH] Password reset requested for: ${email}`);

  // Always return true to prevent user enumeration
  res.json({ ok: true, message: "If account exists, reset email sent" });
});

router.get("/google", (req, res) => {
  // Placeholder for Google OAuth redirection
  console.log("[AUTH] Google Login initiated (Not implemented without keys)");
  res.send(`
    <style>body{font-family:sans-serif;background:#000;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh}</style>
    <h1>Google Login Placeholder</h1>
    <p>To enable Google Login:</p>
    <ol>
      <li>Get GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET from Google Cloud Console</li>
      <li>Add them to server/experimenting with Passport.js</li>
    </ol>
    <a href="http://localhost:5174" style="color:#4ADE80">Back to App</a>
  `);
});

export default router;
