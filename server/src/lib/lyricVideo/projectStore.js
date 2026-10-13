// server/src/lib/lyricVideo/projectStore.js
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseSheet } from "./sheetParser.js";

const DIR = "lyric-projects";
const PREFS = "lyric-video-prefs.json";

const dirOf = (dataDir) => path.join(dataDir, DIR);
function fileOf(dataDir, id) {
  const safe = String(id || "");
  if (!/^lv_[a-z0-9]+$/.test(safe)) return null;
  return path.join(dirOf(dataDir), `${safe}.json`);
}

export function cleanText(value, max = 100) {
  // eslint-disable-next-line no-control-regex
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
}

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1), "utf8");
  fs.renameSync(tmp, file);
}

export function createProject(dataDir, { title, artist }) {
  const now = new Date().toISOString();
  const project = {
    projectId: `lv_${crypto.randomBytes(8).toString("hex")}`,
    version: 1, createdAt: now, updatedAt: now,
    title: cleanText(title) || "Untitled song", artist: cleanText(artist),
    song: null, sheet: { raw: "", parsedAt: null }, sections: [], lines: [],
    timing: { status: "idle" },
    look: { id: "studio-lagos-night", energy: "wild", seed: 1 },
    background: null, renders: [],
  };
  atomicWrite(fileOf(dataDir, project.projectId), project);
  return project;
}

export function readProject(dataDir, id) {
  const file = fileOf(dataDir, id);
  if (!file || !fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

export function writeProject(dataDir, project) {
  const file = fileOf(dataDir, project.projectId);
  if (!file) throw new Error("invalid projectId");
  const next = { ...project, updatedAt: new Date().toISOString() };
  atomicWrite(file, next);
  return next;
}

export function listProjects(dataDir) {
  if (!fs.existsSync(dirOf(dataDir))) return [];
  return fs.readdirSync(dirOf(dataDir)).filter((f) => /^lv_[a-z0-9]+\.json$/.test(f))
    .map((f) => readProject(dataDir, f.replace(/\.json$/, ""))).filter(Boolean)
    .map((p) => ({ projectId: p.projectId, title: p.title, artist: p.artist, updatedAt: p.updatedAt, hasRender: (p.renders || []).length > 0 }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function deleteProject(dataDir, id) {
  const file = fileOf(dataDir, id);
  if (!file || !fs.existsSync(file)) return false;
  fs.rmSync(file);
  return true;
}

export function readPrefs(dataDir) {
  try { return { artist: cleanText(JSON.parse(fs.readFileSync(path.join(dataDir, PREFS), "utf8")).artist) }; } catch { return { artist: "" }; }
}

export function writePrefs(dataDir, { artist }) {
  const prefs = { artist: cleanText(artist) };
  atomicWrite(path.join(dataDir, PREFS), prefs);
  return prefs;
}

export function carryOverTiming(oldLines, newLines) {
  const pool = new Map();
  for (const l of oldLines || []) {
    const k = l.text.trim();
    if (!pool.has(k)) pool.set(k, []);
    pool.get(k).push(l);
  }
  const seen = new Map();
  return newLines.map((l) => {
    const k = l.text.trim();
    const n = seen.get(k) || 0;
    seen.set(k, n + 1);
    const old = pool.get(k)?.[n];
    if (!old) return l;
    const { words, start, end, locked, effect, confidence, flag } = old;
    return { ...l, words, start, end, locked, effect, confidence, flag };
  });
}

export function applySheet(project, raw) {
  const parsed = parseSheet(raw);
  const fresh = parsed.lines.map((l) => ({ ...l, effect: "auto", locked: false }));
  return {
    ...project,
    sheet: { raw: String(raw), parsedAt: new Date().toISOString(), skipped: parsed.skipped },
    sections: parsed.sections,
    lines: carryOverTiming(project.lines, fresh),
    timing: { ...(project.timing || {}), status: "idle" },
  };
}
