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

function isProjectOf(value, id) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && typeof value.projectId === "string" && value.projectId === String(id);
}

export function readProject(dataDir, id) {
  const file = fileOf(dataDir, id);
  if (!file || !fs.existsSync(file)) return null;
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
  return isProjectOf(parsed, id) ? parsed : null;
}

export function writeProject(dataDir, project) {
  if (typeof project?.projectId !== "string") throw new Error("invalid projectId");
  const file = fileOf(dataDir, project.projectId);
  if (!file) throw new Error("invalid projectId");
  const next = { ...project, updatedAt: new Date().toISOString() };
  atomicWrite(file, next);
  return next;
}

/** Reads the latest on-disk version, applies fn, writes it back. Never recreates a deleted project. */
export function updateProject(dataDir, id, fn) {
  const latest = readProject(dataDir, id);
  if (!latest) return null;
  const next = fn(latest);
  if (typeof next?.projectId !== "string" || next.projectId !== latest.projectId) {
    throw new Error("updateProject cannot change projectId");
  }
  return writeProject(dataDir, next);
}

export function listProjects(dataDir) {
  if (!fs.existsSync(dirOf(dataDir))) return [];
  return fs.readdirSync(dirOf(dataDir)).filter((f) => /^lv_[a-z0-9]+\.json$/.test(f))
    .map((f) => readProject(dataDir, f.replace(/\.json$/, ""))).filter(Boolean)
    .map((p) => ({ projectId: p.projectId, title: p.title, artist: p.artist, updatedAt: p.updatedAt, hasRender: Array.isArray(p.renders) && p.renders.length > 0 }))
    .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
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

/** Index pairs [i, j] of an order-preserving longest common subsequence of a and b. */
function matchedPairs(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

/**
 * Pairs old and new lines by their trimmed text, in order, so a repeated line
 * keeps the timing of the same occurrence even when another copy is edited or removed.
 */
export function carryOverTiming(oldLines, newLines) {
  const oldArr = oldLines || [];
  const oldKeys = oldArr.map((l) => String(l.text ?? "").trim());
  const newKeys = newLines.map((l) => String(l.text ?? "").trim());
  const out = newLines.slice();
  for (const [i, j] of matchedPairs(oldKeys, newKeys)) {
    const { words, start, end, locked, effect, confidence, flag } = oldArr[i];
    out[j] = { ...newLines[j], words, start, end, locked, effect, confidence, flag };
  }
  return out;
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
