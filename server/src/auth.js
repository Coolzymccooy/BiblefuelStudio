import crypto from "crypto";
import fs from "fs";
import path from "path";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { DATA_DIR } from "./lib/paths.js";

const getDataPaths = () => {
  const dataDir = DATA_DIR;
  const usersFile = path.join(DATA_DIR, "users.json");
  return { dataDir, usersFile };
};

function ensureDataDir() {
  const { dataDir, usersFile } = getDataPaths();
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(usersFile)) fs.writeFileSync(usersFile, JSON.stringify({ users: [] }, null, 2));
}

export function getUsersStore() {
  ensureDataDir();
  const { usersFile } = getDataPaths();
  return JSON.parse(fs.readFileSync(usersFile, "utf-8"));
}

export function saveUsersStore(store) {
  ensureDataDir();
  const { usersFile } = getDataPaths();
  fs.writeFileSync(usersFile, JSON.stringify(store, null, 2));
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
  const secret = process.env.JWT_SECRET || "dev_secret_change_me";
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

const OAUTH_STATE_AUDIENCE ="biblefuel-oauth-state";

// OAuth states travel through Google's and Zernio's redirects, so they land in
// third-party logs and browser history. Signing them with a key derived from
// JWT_SECRET, never JWT_SECRET itself, means a leaked state cannot be used as
// a login token.
function oauthStateSecret() {
  const base = process.env.JWT_SECRET || "dev_secret_change_me";
  return crypto.createHmac("sha256", base).update(OAUTH_STATE_AUDIENCE).digest("hex");
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

export function requireAuth(req, res, next) {
  try {
    const header = req.headers["authorization"] || "";
    let token = header.startsWith("Bearer ") ? header.slice(7) : null;

    // Fallback to query parameter (useful for direct browser downloads/exports)
    if (!token && req.query.token) {
      token = String(req.query.token);
    }

    if (!token) return res.status(401).json({ ok: false, error: "Missing Bearer token" });

    const secret = process.env.JWT_SECRET || "dev_secret_change_me";
    const decoded = jwt.verify(token, secret);
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
