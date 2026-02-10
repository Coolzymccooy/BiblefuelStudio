import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { hasAnyUser, createOwner, verifyUser, signToken } from "../auth.js";

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  standardHeaders: "draft-7",
  legacyHeaders: false
});

router.use(authLimiter);

router.get("/status", (req, res) => {
  res.json({ ok: true, hasUser: hasAnyUser() });
});

router.post("/setup", async (req, res) => {
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

router.post("/login", async (req, res) => {
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

router.post("/forgot-password", (req, res) => {
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
