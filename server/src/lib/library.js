import fs from "fs";
import path from "path";
import { writeJsonAtomic } from "./atomicFile.js";

function libraryFilePath(dataDir) {
  if (!dataDir) throw new Error("library: dataDir required");
  return path.join(dataDir, "library.json");
}

function ensure(dataDir) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const f = libraryFilePath(dataDir);
  if (!fs.existsSync(f)) writeJsonAtomic(f, { items: [] });
}

export function readLibrary(dataDir) {
  ensure(dataDir);
  try {
    return JSON.parse(fs.readFileSync(libraryFilePath(dataDir), "utf-8"));
  } catch {
    return { items: [] };
  }
}

export function writeLibrary(dataDir, data) {
  ensure(dataDir);
  writeJsonAtomic(libraryFilePath(dataDir), data);
}

export function addToLibrary(dataDir, item) {
  const lib = readLibrary(dataDir);
  const now = new Date().toISOString();
  const idx = lib.items.findIndex((x) => x.id === item.id);

  if (idx >= 0) {
    const existing = lib.items[idx];
    const merged = {
      ...existing,
      ...item,
      id: item.id,
      savedAt: existing.savedAt || now,
      updatedAt: now,
    };
    lib.items.splice(idx, 1);
    lib.items.unshift(merged);
    writeLibrary(dataDir, lib);
    return merged;
  }

  const created = { ...item, savedAt: now, updatedAt: now };
  lib.items.unshift(created);
  writeLibrary(dataDir, lib);
  return created;
}

export function removeFromLibrary(dataDir, id) {
  const lib = readLibrary(dataDir);
  lib.items = lib.items.filter((x) => x.id !== id);
  writeLibrary(dataDir, lib);
}
