import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MUSIC_DIR = path.resolve(__dirname, "../../assets/music");

/** The 10 default gospel beds. Files live in server/assets/music/. */
export const MUSIC_LIBRARY = [
  { id: "peaceful-worship", label: "Peaceful Worship", mood: "calm", file: "01-peaceful-worship.mp3", default: true },
  { id: "hopeful-strings", label: "Hopeful Strings", mood: "uplifting", file: "02-hopeful-strings.mp3" },
  { id: "gentle-piano", label: "Gentle Piano", mood: "reflective", file: "03-gentle-piano.mp3" },
  { id: "uplifting-pads", label: "Uplifting Pads", mood: "uplifting", file: "04-uplifting-pads.mp3" },
  { id: "reflective-acoustic", label: "Reflective Acoustic", mood: "reflective", file: "05-reflective-acoustic.mp3" },
  { id: "joyful-praise", label: "Joyful Praise", mood: "joyful", file: "06-joyful-praise.mp3" },
  { id: "cinematic-hope", label: "Cinematic Hope", mood: "cinematic", file: "07-cinematic-hope.mp3" },
  { id: "soft-prayer", label: "Soft Prayer", mood: "calm", file: "08-soft-prayer.mp3" },
  { id: "warm-devotion", label: "Warm Devotion", mood: "calm", file: "09-warm-devotion.mp3" },
  { id: "triumphant-rise", label: "Triumphant Rise", mood: "triumphant", file: "10-triumphant-rise.mp3" },
];

export function listTracks() {
  return MUSIC_LIBRARY.map((t) => ({
    id: t.id, label: t.label, mood: t.mood,
    previewUrl: `/music/${t.file}`, default: Boolean(t.default),
  }));
}

/** Resolve a `library:<id>` ref to an existing absolute file path, else null. */
export function resolveLibraryTrack(ref) {
  const s = String(ref || "").trim();
  if (!s.startsWith("library:")) return null;
  const id = s.slice("library:".length);
  const track = MUSIC_LIBRARY.find((t) => t.id === id);
  if (!track) return null;
  const full = path.join(MUSIC_DIR, track.file);
  return fs.existsSync(full) ? full : null;
}

export function defaultTrackRef() {
  const def = MUSIC_LIBRARY.find((t) => t.default) || MUSIC_LIBRARY[0];
  return `library:${def.id}`;
}
