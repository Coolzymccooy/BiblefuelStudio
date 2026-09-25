import crypto from "crypto";

/**
 * Scripture drops — the spoken moments that land on the music bed.
 *
 * A drop is a reference plus a time. The text is ALWAYS fetched verbatim from
 * the Bible API and never written by a model; this module only decides *when*
 * a verse speaks and hands the words through untouched.
 */

/** The spec's default cadence: a verse every fifteen minutes. */
export const DEFAULT_INTERVAL_SEC = 900;

/**
 * Leave the last minute clear. A verse that starts eight seconds before the
 * video ends gets cut mid-sentence, which reads as a broken render.
 */
const TAIL_GUARD_SEC = 60;

/**
 * @param {number} targetSec
 * @param {number} [intervalSec]
 * @returns {number[]} drop times in milliseconds
 */
export function defaultDropTimes(targetSec, intervalSec = DEFAULT_INTERVAL_SEC) {
  const total = Number(targetSec) || 0;
  const cadence = Number(intervalSec) > 0 ? Number(intervalSec) : DEFAULT_INTERVAL_SEC;
  // The cadence is a default for long sessions, not a floor. Capped at half
  // the runtime, a session shorter than the cadence still holds one verse at
  // its midpoint — applied as a floor, anything under sixteen minutes held
  // none and "Suggest verses" refused outright.
  const step = Math.min(cadence, total / 2);
  const times = [];
  if (!(step > 0)) return times;
  for (let t = step; t <= total - TAIL_GUARD_SEC; t += step) times.push(Math.round(t * 1000));
  return times;
}

/**
 * Sort, id and clamp drops. The client may send them in any order after a
 * retime, and the render graph offsets each drop with `adelay` — an out-of-order
 * or out-of-range list would silently produce overlapping or truncated speech.
 *
 * @param {Array<object>} input
 * @param {{ targetSec: number, translation?: string }} opts
 */
export function normaliseDrops(input, { targetSec, translation = "kjv" } = {}) {
  const maxMs = Math.max(0, (Number(targetSec) || 0) * 1000 - 1);
  return (Array.isArray(input) ? input : [])
    .map((d) => ({
      id: String(d?.id || crypto.randomUUID()),
      atMs: Math.min(Math.max(Math.round(Number(d?.atMs) || 0), 0), maxMs),
      reference: String(d?.reference || "").trim(),
      translation: String(d?.translation || translation).toLowerCase(),
      text: typeof d?.text === "string" ? d.text : null,
      // Each verse on its own, so a passage can be captioned a verse at a time.
      verses: Array.isArray(d?.verses) ? d.verses.filter((v) => typeof v === "string") : null,
      voiceId: d?.voiceId || null,
      audioPath: d?.audioPath || null,
      durationMs: Number(d?.durationMs) > 0 ? Number(d.durationMs) : null,
      status: d?.status === "done" || d?.status === "error" ? d.status : "pending",
      error: d?.error || null,
    }))
    .filter((d) => d.reference)
    .sort((a, b) => a.atMs - b.atMs);
}

/**
 * Fill in verbatim text and synthesised audio for every drop that needs it.
 *
 * One bad reference must not sink the build: a drop that fails lookup or
 * synthesis is marked `status:'error'` and the remaining drops continue. Eight
 * verses should not be held hostage by a typo in the third.
 *
 * Dependencies are injected so tests never hit the network or a TTS provider.
 *
 * @param {object} project
 * @param {{ lookupVerses: Function, synthesize: Function, probeAudioDurationSec: Function, voiceId?: string|null, force?: boolean }} deps
 * @returns {Promise<Array<object>>} a new drops array
 */
export async function voiceDrops(project, deps) {
  const { lookupVerses, synthesize, probeAudioDurationSec, voiceId = null, force = false } = deps;
  const out = [];
  for (const drop of project.drops || []) {
    if (!force && drop.status === "done" && drop.audioPath) {
      out.push(drop);
      continue;
    }
    try {
      const looked = await lookupVerses(drop.reference, drop.translation || project.translation || "kjv");
      const verses = Array.isArray(looked?.verses) ? looked.verses : [];
      const verseTexts = verses
        .map((v) => String(v?.text || "").replace(/\s+/g, " ").trim())
        .filter(Boolean);
      const text = verseTexts.join(" ");
      if (!text) throw new Error(`no verse text returned for "${drop.reference}"`);

      const spoken = await synthesize({ text, voiceId: drop.voiceId || voiceId || undefined });
      const file = spoken?.file;
      if (!spoken?.ok || !file) throw new Error(`synthesis returned no audio for "${drop.reference}"`);

      let durationMs = null;
      try {
        const sec = await probeAudioDurationSec(file);
        if (Number(sec) > 0) durationMs = Math.round(Number(sec) * 1000);
      } catch {
        // A missing duration costs us the caption timing for this drop, not the
        // drop itself — the audio still plays at its offset.
      }

      out.push({ ...drop, text, verses: verseTexts, audioPath: file, durationMs, status: "done", error: null });
    } catch (err) {
      out.push({ ...drop, status: "error", error: String(err?.message || err) });
    }
  }
  return out;
}
