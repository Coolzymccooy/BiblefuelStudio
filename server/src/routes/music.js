import { Router } from "express";
import fs from "fs";
import path from "path";
import { listTracks } from "../lib/musicLibrary.js";
import {
  readMusicLibrary, registerTrack, updateTrack, removeTrack,
} from "../lib/musicLibraryStore.js";
import { probeAudioDurationSec } from "../lib/story/storyRender.js";

const router = Router();

/** A tenant upload, in the shape the picker already understands. */
function toListed(track) {
  return {
    id: track.id,
    label: track.label,
    mood: track.mood,
    previewUrl: null, // uploads are served through the authed /outputs path, not /music
    default: false,
    source: "upload",
    licence: track.licence,
    durationSec: track.durationSec,
    ref: `mylib:${track.id}`,
  };
}

// Bundled first (they are the curated set), then the operator's own.
router.get("/library", (req, res) => {
  const bundled = listTracks().map((t) => ({
    ...t,
    source: "bundled",
    licence: "pixabay-cleared",
    durationSec: null,
    ref: `library:${t.id}`,
  }));
  const mine = readMusicLibrary(req.ctx.dataDir).items.map(toListed);
  res.json({ ok: true, tracks: [...bundled, ...mine] });
});

// Remember a file the operator has ALREADY uploaded through
// POST /api/media/upload-audio (or the resumable pair). This route does not
// receive bytes; it only records what is already on disk.
router.post("/upload", async (req, res) => {
  try {
    const file = path.resolve(String(req.body?.file || "").trim());
    const root = path.resolve(req.ctx.outputDir);
    if (file !== root && !file.startsWith(root + path.sep)) {
      return res.status(403).json({ ok: false, error: "That file is outside your media folder" });
    }
    if (!fs.existsSync(file)) {
      return res.status(400).json({ ok: false, error: "That file is no longer there" });
    }
    // Canonicalize both paths to reject symlinks that escape the outputDir.
    // fs.realpathSync throws if the path disappears between checks — treat that as 400.
    let realFile, realRoot;
    try {
      realFile = fs.realpathSync(file);
      realRoot = fs.realpathSync(root);
    } catch {
      return res.status(400).json({ ok: false, error: "That file is no longer there" });
    }
    if (realFile !== realRoot && !realFile.startsWith(realRoot + path.sep)) {
      return res.status(403).json({ ok: false, error: "That file is outside your media folder" });
    }
    // A duration makes the picker useful ("3:02") and lets a later bed
    // assembly know how many tracks it needs. A probe failure is not fatal.
    // probeAudioDurationSec is declared `function` (storyRender.js:435) and
    // returns a promise; awaiting it is correct, and a rejection must not
    // cost the operator their saved track.
    let durationSec = null;
    try { durationSec = await probeAudioDurationSec(file); } catch { durationSec = null; }

    const track = registerTrack(req.ctx.dataDir, {
      file,
      label: req.body?.label,
      mood: req.body?.mood,
      licence: req.body?.licence,
      durationSec,
    });
    return res.json({ ok: true, track: toListed(track) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

router.patch("/:id", (req, res) => {
  const track = updateTrack(req.ctx.dataDir, req.params.id, {
    label: req.body?.label,
    mood: req.body?.mood,
    licence: req.body?.licence,
  });
  if (!track) return res.status(404).json({ ok: false, error: "track not found" });
  return res.json({ ok: true, track: toListed(track) });
});

router.delete("/:id", (req, res) => {
  const bundled = listTracks().some((t) => t.id === req.params.id);
  if (bundled) return res.status(400).json({ ok: false, error: "Bundled tracks ship with the app" });
  if (!removeTrack(req.ctx.dataDir, req.params.id)) {
    return res.status(404).json({ ok: false, error: "track not found" });
  }
  return res.json({ ok: true });
});

export default router;
