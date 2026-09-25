import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MUSIC_DIR = path.resolve(__dirname, "../../assets/music");

/**
 * The default gospel music beds. Files live in server/assets/music/.
 *
 * Instrumental tracks are bed-safe (they sit under narration). The five
 * `(vocal)` gospel songs carry lyrics, so they are offered for selection but
 * are NOT good auto-applied beds under a voiceover — the default is therefore
 * an instrumental calm worship track. All tracks are Pixabay-license /
 * royalty-free, free for commercial use, no attribution required.
 */
export const MUSIC_LIBRARY = [
  { id: "peaceful-worship", label: "Peaceful Worship", mood: "calm", file: "01-peaceful-worship.mp3", default: true },
  { id: "prayer-piano", label: "Prayer Piano", mood: "calm", file: "02-prayer-piano.mp3" },
  { id: "heaven-prayer", label: "Harmony of Heaven", mood: "calm", file: "03-heaven-prayer.mp3" },
  { id: "worship-is-worship", label: "Worship Is Worship", mood: "calm", file: "04-worship-is-worship.mp3" },
  { id: "gentle-peace", label: "Gentle Peace", mood: "calm", file: "05-gentle-peace.mp3" },
  { id: "gentle-calm", label: "Gentle Calm", mood: "calm", file: "06-gentle-calm.mp3" },
  { id: "hopeful", label: "Hopeful", mood: "uplifting", file: "07-hopeful.mp3" },
  { id: "reflective-acoustic", label: "Reflective Acoustic", mood: "reflective", file: "08-reflective-acoustic.mp3" },
  { id: "sentimental-acoustic", label: "Sentimental Acoustic", mood: "reflective", file: "09-sentimental-acoustic.mp3" },
  { id: "devotional", label: "Devotional", mood: "calm", file: "10-devotional.mp3" },
  { id: "cinematic-inspirational", label: "Cinematic Inspirational", mood: "cinematic", file: "11-cinematic-inspirational.mp3" },
  { id: "cinematic-epic", label: "Cinematic Epic", mood: "cinematic", file: "12-cinematic-epic.mp3" },
  { id: "inspiring-cinematic", label: "Inspiring Cinematic", mood: "cinematic", file: "13-inspiring-cinematic.mp3" },
  { id: "inspirational-epic", label: "Inspirational Epic", mood: "cinematic", file: "14-inspirational-epic.mp3" },
  { id: "ascend-to-glory", label: "Ascend to Glory", mood: "triumphant", file: "15-ascend-to-glory.mp3" },
  { id: "epic-corporate", label: "Epic Corporate", mood: "triumphant", file: "16-epic-corporate.mp3" },
  { id: "epic-anthem", label: "Epic Anthem", mood: "triumphant", file: "17-epic-anthem.mp3" },
  { id: "dramatic", label: "Dramatic", mood: "cinematic", file: "18-dramatic.mp3" },
  { id: "gospel-praise", label: "Gospel Praise (vocal)", mood: "joyful", file: "19-gospel-praise.mp3" },
  { id: "gospel-revival", label: "Gospel Revival (vocal)", mood: "joyful", file: "20-gospel-revival.mp3" },
  { id: "gospel-testimony", label: "Gospel Testimony (vocal)", mood: "joyful", file: "21-gospel-testimony.mp3" },
  { id: "gospel-fire", label: "Gospel Fire (vocal)", mood: "joyful", file: "22-gospel-fire.mp3" },
  { id: "nothing-compares", label: "Nothing Compares (vocal)", mood: "worship", file: "23-nothing-compares.mp3" },
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
