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

  const store = getUsersStore();
  const existing = store.users.find((u) =>
    String(u?.firebaseUid || "") === uid ||
    String(u?.email || "").toLowerCase() === email.toLowerCase()
  );

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
    if (changed) saveUsersStore(store);
    return { id: existing.id, email: existing.email, role: existing.role || "owner" };
  }

  const user = {
    id: `u_${Date.now()}`,
    email,
    passwordHash: "",
    role: "owner",
    provider: "firebase",
    firebaseUid: uid,
    createdAt: new Date().toISOString()
  };
  store.users.push(user);
  saveUsersStore(store);
  return { id: user.id, email: user.email, role: user.role };
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
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, secret, { expiresIn });
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
    req.user = decoded;
    return next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: "Invalid token" });
  }
}
