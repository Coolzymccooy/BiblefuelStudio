import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

/**
 * Per-user Chatterbox cloned-voice registry.
 *
 * Layout: DATA_DIR/users/<userId>/chatterbox-voices.json
 * Shape:  { voices: [{ id, name, description?, refPath, refFilename?, createdAt }] }
 *
 * Unlike ElevenLabs, Chatterbox "cloning" isn't a cloud-side operation — the
 * model conditions on a reference WAV at synthesis time. We store the path
 * of the reference (on the Chatterbox host's filesystem, as returned by the
 * bridge's /upload endpoint) and a friendly name. The synthetic voice id we
 * issue to the client carries the "cb:" prefix, so chatterboxProvider can
 * distinguish a real Chatterbox path from a saved-clone alias.
 *
 * Concurrent writes are serialised via an in-process promise queue.
 */

function voicesFilePath(dataDir) {
  if (!dataDir) throw new Error("chatterbox-voices: dataDir required");
  return path.join(dataDir, "chatterbox-voices.json");
}

const DEFAULT_RECORD = Object.freeze({ voices: [] });

function readSync(dataDir) {
  try {
    if (!fs.existsSync(dataDir)) return { voices: [] };
    const file = voicesFilePath(dataDir);
    if (!fs.existsSync(file)) return { voices: [] };
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (!parsed || !Array.isArray(parsed.voices)) return { voices: [] };
    return {
      voices: parsed.voices
        .filter((v) => v && typeof v.id === "string" && typeof v.refPath === "string")
        .map((v) => ({
          id: String(v.id),
          name: String(v.name || "Untitled"),
          description: typeof v.description === "string" ? v.description : "",
          refPath: String(v.refPath),
          refFilename: typeof v.refFilename === "string" ? v.refFilename : null,
          createdAt: String(v.createdAt || new Date().toISOString()),
        })),
    };
  } catch {
    return { ...DEFAULT_RECORD, voices: [] };
  }
}

function writeSync(dataDir, record) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(voicesFilePath(dataDir), JSON.stringify(record, null, 2));
}

// Per-process write serializer so add/remove from different requests don't
// race and lose updates.
const writeQueues = new Map();
function withWriteLock(dataDir, work) {
  const key = dataDir;
  const prev = writeQueues.get(key) || Promise.resolve();
  const next = prev.then(work, work);
  writeQueues.set(
    key,
    next.catch(() => {}).then(() => {
      if (writeQueues.get(key) === next) writeQueues.delete(key);
    }),
  );
  return next;
}

export function listChatterboxVoices(dataDir) {
  return readSync(dataDir).voices;
}

export function getChatterboxVoiceById(dataDir, id) {
  if (!id) return null;
  const rec = readSync(dataDir);
  return rec.voices.find((v) => v.id === id) || null;
}

/**
 * @param {string} dataDir
 * @param {{name: string, description?: string, refPath: string, refFilename?: string}} voice
 */
export async function addChatterboxVoice(dataDir, voice) {
  const name = String(voice?.name || "").trim();
  const refPath = String(voice?.refPath || "").trim();
  if (name.length < 2) throw new Error("Voice name must be at least 2 characters");
  if (!refPath) throw new Error("Reference path is required");
  const id = `cb:${randomUUID()}`;
  const entry = {
    id,
    name: name.slice(0, 80),
    description: String(voice?.description || "").slice(0, 280),
    refPath,
    refFilename: voice?.refFilename || null,
    createdAt: new Date().toISOString(),
  };
  await withWriteLock(dataDir, () => {
    const rec = readSync(dataDir);
    rec.voices.unshift(entry);
    writeSync(dataDir, rec);
  });
  return entry;
}

export async function removeChatterboxVoice(dataDir, id) {
  if (!id) return false;
  let removed = false;
  await withWriteLock(dataDir, () => {
    const rec = readSync(dataDir);
    const before = rec.voices.length;
    rec.voices = rec.voices.filter((v) => v.id !== id);
    removed = rec.voices.length !== before;
    if (removed) writeSync(dataDir, rec);
  });
  return removed;
}
