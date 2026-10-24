import crypto from "crypto";
import fs from "fs";
import path from "path";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { DATA_DIR } from "./lib/paths.js";
import { writeJsonAtomic } from "./lib/atomicFile.js";

const DEV_JWT_SECRET = "dev_secret_change_me";

/**
 * Why this JWT_SECRET must not be used in production, or null when it is fine.
 * With the default, anyone who has read this file can sign a login.
 */
export function jwtSecretProblem(env = process.env) {
  if (env.NODE_ENV !== "production") return null;
  const secret = String(env.JWT_SECRET || "").trim();
  if (!secret) return "JWT_SECRET is not set. Set a long random value (32+ characters) before starting in production.";
  if (secret === DEV_JWT_SECRET) return "JWT_SECRET is the default development value. Set a long random value (32+ characters).";
  return null;
}

/** Called at start-up: a production server refuses to run with a guessable secret. */
export function assertJwtSecret(env = process.env) {
  const problem = jwtSecretProblem(env);
  if (problem) throw new Error(problem);
  const secret = String(env.JWT_SECRET || "").trim();
  if (env.NODE_ENV === "production" && secret.length < 32) {
    console.warn("⚠️  JWT_SECRET is shorter than 32 characters. Replace it with a longer random value (everyone signs in again).");
  }
}

const jwtSecret = () => process.env.JWT_SECRET || DEV_JWT_SECRET;

const getDataPaths = () => {
  const dataDir = DATA_DIR;
  const usersFile = path.join(DATA_DIR, "users.json");
  return { dataDir, usersFile };
};

function ensureDataDir() {
  const { dataDir, usersFile } = getDataPaths();
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(usersFile)) writeJsonAtomic(usersFile, { users: [] });
}

export function getUsersStore() {
  ensureDataDir();
  const { usersFile } = getDataPaths();
  return JSON.parse(fs.readFileSync(usersFile, "utf-8"));
}

export function saveUsersStore(store) {
  ensureDataDir();
  const { usersFile } = getDataPaths();
  writeJsonAtomic(usersFile, store);
}

export function hasAnyUser() {
  const store = getUsersStore();
  return Array.isArray(store.users) && store.users.length > 0;
}

export async function createOwner(email, password) {
  const store = getUsersStore();
  const exists = store.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
  if (exists) throw new Error("User already exists");
  const passwordHash = await bcrypt.hash(password, 10);
  const user = { id: `u_${Date.now()}`, email, passwordHash, role: "owner", createdAt: new Date().toISOString() };
  store.users.push(user);
  saveUsersStore(store);
  return { id: user.id, email: user.email, role: user.role };
}

export function upsertFirebaseUser(decodedToken) {
  const uid = String(decodedToken?.uid || "").trim();
  if (!uid) throw new Error("Firebase token missing uid");

  const rawEmail = String(decodedToken?.email || "").trim();
  const email = rawEmail || `${uid}@firebase.local`;
  const emailVerified = Boolean(decodedToken?.email_verified);

  const store = getUsersStore();
  const existing = store.users.find((u) =>
    String(u?.firebaseUid || "") === uid ||
    String(u?.email || "").toLowerCase() === email.toLowerCase()
  );

  // Default role for NEW signups in the multi-tenant world is "user".
  // The super-admin is identified by SUPER_ADMIN_EMAIL/SUPER_ADMIN_USER_ID
  // env (src/lib/userPlan.js). Role here is documentation; capability
  // gating runs on plan tier.
  const defaultRoleForNewUser = "user";

  if (existing) {
    let changed = false;
    if (!existing.firebaseUid) {
      existing.firebaseUid = uid;
      changed = true;
    }
    if (!existing.provider) {
      existing.provider = "firebase";
      changed = true;
    }
    if (!existing.email && email) {
      existing.email = email;
      changed = true;
    }
    if (Boolean(existing.emailVerified) !== emailVerified) {
      existing.emailVerified = emailVerified;
      changed = true;
    }
    if (changed) saveUsersStore(store);
    return {
      id: existing.id,
      email: existing.email,
      role: existing.role || defaultRoleForNewUser,
      emailVerified,
    };
  }

  const user = {
    id: `u_${Date.now()}`,
    email,
    passwordHash: "",
    role: defaultRoleForNewUser,
    provider: "firebase",
    firebaseUid: uid,
    emailVerified,
    createdAt: new Date().toISOString()
  };
  store.users.push(user);
  saveUsersStore(store);
  return { id: user.id, email: user.email, role: user.role, emailVerified };
}

/**
 * Permanently delete a user record. The caller is responsible for cleaning
 * up the per-user dir under DATA_DIR/users/<userId>/.
 */
export function deleteUserById(userId) {
  const store = getUsersStore();
  const idx = store.users.findIndex((u) => String(u?.id || "") === String(userId || ""));
  if (idx < 0) return false;
  store.users.splice(idx, 1);
  saveUsersStore(store);
  return true;
}

export async function verifyUser(email, password) {
  const store = getUsersStore();
  const user = store.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;
  return { id: user.id, email: user.email, role: user.role };
}

export function signToken(user) {
  const secret = jwtSecret();
  const expiresIn = process.env.JWT_EXPIRES_IN || "7d";
  const claims = {
    sub: user.id,
    email: user.email,
    role: user.role,
  };
  if (user.emailVerified !== undefined) {
    claims.emailVerified = Boolean(user.emailVerified);
  }
  return jwt.sign(claims, secret, { expiresIn });
}

/**
 * A 60-second token the MCP layer uses for loopback calls into the app's own
 * routes on behalf of one user. `via: "mcp"` lets refuseAgentCalls keep it off
 * account routes.
 * @param {{ sub: string, email: string, role: string, emailVerified?: boolean }} user
 */
export function signInternalToken(user) {
  const secret = process.env.JWT_SECRET || "dev_secret_change_me";
  const claims = {
    sub: user.sub,
    email: user.email,
    role: user.role,
    emailVerified: Boolean(user.emailVerified),
    via: "mcp",
  };
  return jwt.sign(claims, secret, { expiresIn: "60s" });
}

const OAUTH_STATE_AUDIENCE = "biblefuel-oauth-state";

// OAuth states travel through Google's and Zernio's redirects, so they land in
// third-party logs and browser history. Signing them with a key derived from
// JWT_SECRET, never JWT_SECRET itself, means a leaked state cannot be used as
// a login token.
function oauthStateSecret() {
  return crypto.createHmac("sha256", jwtSecret()).update(OAUTH_STATE_AUDIENCE).digest("hex");
}

/**
 * @param {object} claims must include `purpose`
 * @param {string} expiresIn e.g. "15m"
 */
export function signOAuthState(claims, expiresIn) {
  if (!claims?.purpose) throw new Error("An OAuth state needs a purpose.");
  return jwt.sign(claims, oauthStateSecret(), { expiresIn, audience: OAUTH_STATE_AUDIENCE });
}

/** The state's claims when it is valid, unexpired and for `purpose`; otherwise null. */
export function verifyOAuthState(token, purpose) {
  try {
    const decoded = jwt.verify(String(token || ""), oauthStateSecret(), { audience: OAUTH_STATE_AUDIENCE });
    return decoded && decoded.purpose === purpose ? decoded : null;
  } catch {
    return null;
  }
}

const URL_TOKEN_AUDIENCE = "biblefuel-url";
const urlTokenSecret = () => crypto.createHmac("sha256", jwtSecret()).update(URL_TOKEN_AUDIENCE).digest("hex");

/**
 * A token for one URL, for the few requests that cannot send a header (an
 * EventSource, say). It opens only `urlPath`, is signed with its own key so it
 * is never a login, and expires. A login token is never accepted in a URL:
 * URLs end up in proxy logs and browser history.
 * @param {string|number} expiresIn e.g. "6h", or seconds
 */
export function signUrlToken(user, urlPath, expiresIn = "15m") {
  const claims = { sub: user.id ?? user.sub, email: user.email, role: user.role, path: String(urlPath) };
  if (user.emailVerified !== undefined) claims.emailVerified = Boolean(user.emailVerified);
  return jwt.sign(claims, urlTokenSecret(), { expiresIn, audience: URL_TOKEN_AUDIENCE });
}

function userFromUrlToken(token, requestPath) {
  const decoded = jwt.verify(token, urlTokenSecret(), { audience: URL_TOKEN_AUDIENCE });
  if (!decoded || decoded.path !== requestPath) return null;
  const { path: _path, aud: _aud, ...user } = decoded;
  return user;
}

export function requireAuth(req, res, next) {
  try {
    const header = req.headers["authorization"] || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token && req.query.token) {
      const user = userFromUrlToken(String(req.query.token), req.baseUrl + req.path);
      if (!user) return res.status(401).json({ ok: false, error: "Invalid token" });
      req.user = user;
      return next();
    }

    if (!token) return res.status(401).json({ ok: false, error: "Missing Bearer token" });

    const decoded = jwt.verify(token, jwtSecret());
    // A token made for one job (an OAuth state, say) is never a login. OAuth
    // states are also signed with their own key (signOAuthState); this check
    // covers any older single-purpose token signed with JWT_SECRET.
    if (decoded && typeof decoded === "object" && decoded.purpose) {
      return res.status(401).json({ ok: false, error: "Invalid token" });
    }
    req.user = decoded;
    return next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: "Invalid token" });
  }
}
