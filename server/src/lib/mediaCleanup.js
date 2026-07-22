import fs from "fs";
import path from "path";

const MEDIA_EXT = new Set(['.mp4', '.mov', '.webm', '.m4v', '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.jpg', '.jpeg', '.png', '.webp']);

function walkFiles(root, out = []) {
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, entry.name);
    if (entry.isDirectory()) walkFiles(p, out);
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

export function cleanupMediaFiles(rootDir, options = {}) {
  const root = path.resolve(rootDir || '');
  const now = Number(options.now || Date.now());
  const maxAgeDays = Math.max(1, Number(options.maxAgeDays || process.env.MEDIA_CLEANUP_MAX_AGE_DAYS || 14));
  const maxAgeMs = maxAgeDays * 86400_000;
  const dryRun = Boolean(options.dryRun);
  const removed = [];
  const kept = [];

  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return { root, removed, kept };

  for (const file of walkFiles(root)) {
    const resolved = path.resolve(file);
    if (!resolved.startsWith(root + path.sep)) continue;
    if (!MEDIA_EXT.has(path.extname(resolved).toLowerCase())) continue;
    const stat = fs.statSync(resolved);
    const ageMs = now - stat.mtimeMs;
    if (ageMs >= maxAgeMs) {
      if (!dryRun) fs.rmSync(resolved, { force: true });
      removed.push({ path: resolved, bytes: stat.size, ageDays: Math.floor(ageMs / 86400_000) });
    } else {
      kept.push({ path: resolved, bytes: stat.size, ageDays: Math.floor(ageMs / 86400_000) });
    }
  }

  return { root, removed, kept };
}
