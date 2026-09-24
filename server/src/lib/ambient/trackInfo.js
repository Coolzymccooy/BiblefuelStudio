import path from "path";
import { listTracks } from "../musicLibrary.js";
import { readMusicLibrary } from "../musicLibraryStore.js";

/** Bundled tracks ship with the app from Pixabay's free library. */
export const BUNDLED_CREDIT = "Music from Pixabay";

/**
 * What a bed track is called and who to credit, for the tracklist and the
 * description. Never throws: a forgotten track still needs a line.
 *
 * @param {string} dataDir
 * @param {string} ref  `library:<id>`, `mylib:<id>`, or a bare path
 * @returns {{ label: string, credit: string }}
 */
export function trackInfo(dataDir, ref) {
  const raw = String(ref || "");
  if (raw.startsWith("library:")) {
    const t = listTracks().find((x) => x.id === raw.slice("library:".length));
    return t ? { label: t.label, credit: BUNDLED_CREDIT } : { label: raw, credit: "" };
  }
  if (raw.startsWith("mylib:")) {
    const t = readMusicLibrary(dataDir).items.find((x) => x.id === raw.slice("mylib:".length));
    return t ? { label: t.label, credit: t.credit || "" } : { label: raw, credit: "" };
  }
  return { label: path.win32.basename(raw), credit: "" };
}
