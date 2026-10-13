// server/src/lib/lyricVideo/transcribeWindows.js
import { placeLines, normWord } from "./align.js";
import { trimLoops, rejectPass, promptFor } from "./passQuality.js";

const WINDOW_SEC = 30;
const RETRY_SEC = 15;
const BACKUP_SEC = 2; // a window starts this far before the frontier
const OVERLAP_SEC = 5; // when a window places nothing new, the next one overlaps it by this much
const MIN_ADVANCE_SEC = 1; // a frontier that moves less than this counts as no progress
const NEXT_LINES = 8;
const LOW = 0.5;
const RUN = 3;
const KEEP_AFTER_SEC = 0.5; // heard words kept just past the frontier
const PACE_SLACK = 1.5; // songs are not sung at an even pace
const MAX_AUDIO_FACTOR = 3; // all passes together send Whisper at most this many times the song's length

/**
 * The last line heard with confidence, before the first run of RUN lines heard
 * below LOW (scanning from `from`); -1 when there is none. Unheard responses
 * are expected (they are rarely sung back clearly), so they neither start nor
 * break a run.
 *
 * `strict` (pass 0) stops at the first run even before any line was heard, so
 * the reliable prefix is unbroken from the first line. A window instead skips
 * a run it starts in: those lines were sung before the window or not at all,
 * and they are left to interpolation.
 */
function lastReliable(placed, from, { strict = false } = {}) {
  let last = -1;
  let run = 0;
  for (let i = from; i < placed.length; i += 1) {
    const line = placed[i];
    if (line.confidence >= LOW) { last = i; run = 0; continue; }
    if (line.kind === "response") continue;
    run += 1;
    if (run >= RUN && (strict || last >= 0)) break;
  }
  return last;
}

function shift(words, by) {
  return words.map((w) => ({ word: w.word, start: w.start + by, end: w.end + by }));
}

function expectedWords(lines) {
  return new Set(lines.flatMap((l) => String(l.text).split(/\s+/).flatMap((w) => w.split("-")).map(normWord)).filter(Boolean));
}

/**
 * How many lines past the frontier a window's words may come from: the next
 * NEXT_LINES, or as many as the song could sing (at its average pace, with
 * slack) between the last confidently placed line and the window's end. A
 * window right after the frontier is held to the lines its prompt names; one
 * far past it (earlier windows heard nothing) may be anywhere in that stretch.
 * Bounded either way, so chatter cannot match the whole sheet's vocabulary.
 */
function expectedSpan(linesPerSec, secsSinceAnchor) {
  return Math.max(NEXT_LINES, Math.ceil(Math.max(0, secsSinceAnchor) * linesPerSec * PACE_SLACK));
}

const passRecord =(from, to, reason) => ({ from, to, status: reason ? "rejected" : "used", ...(reason ? { reason } : {}) });

/** Pass 0: the whole song, prompted with the sheet, kept only up to its reliable prefix (spec §5.3 steps 1–2). */
async function firstPass({ audioPath, durationSec, lines, transcribe }) {
  const res = await transcribe(audioPath, promptFor(lines));
  const words = trimLoops(res.words || []);
  const reason = rejectPass(words, expectedWords(lines));
  const pass = passRecord(0, durationSec, reason);
  if (reason) return { pass, heard: [], frontier: 0, frontierTime: 0 };
  const placed = placeLines(lines, words, { durationSec });
  const last = lastReliable(placed, 0, { strict: true });
  const frontierTime = last >= 0 ? placed[last].end : 0;
  return { pass, heard: words.filter((w) => w.start < frontierTime + KEEP_AFTER_SEC), frontier: last + 1, frontierTime };
}

/**
 * One window from `from`, retried once narrower when its words are rejected.
 * `got` is null when no try was used; `spent` is the audio sent; `broke` says
 * a try was skipped because it would go over `budget` seconds of audio.
 */
async function hearWindow({ from, durationSec, budget, prompt, expected, transcribe, cutAudio, onProgress, windowNo }) {
  const records = [];
  let spent = 0;
  for (const len of [WINDOW_SEC, RETRY_SEC]) {
    const to = Math.min(durationSec, from + len);
    if (spent + (to - from) > budget) return { got: null, records, spent, broke: true };
    onProgress?.({ window: windowNo, from, to });
    const res = await transcribe(await cutAudio(from, to), prompt);
    spent += to - from;
    const words = trimLoops(shift(res.words || [], from));
    const reason = rejectPass(words, expected);
    records.push(passRecord(from, to, reason));
    if (!reason) return { got: { words, to }, records, spent, broke: false };
  }
  return { got: null, records, spent, broke: false };
}

/**
 * Pass 0 hears the whole song with the whole sheet as a prompt and is kept up
 * to where it stops matching. From there 30 s windows, each prompted with the
 * next lines of the sheet, carry on to the end. See spec §5.3.
 */
export async function transcribeSong({ audioPath, durationSec, lines, transcribe, cutAudio, onProgress }) {
  const first = await firstPass({ audioPath, durationSec, lines, transcribe });
  let passes = [first.pass];
  let { heard, frontier, frontierTime } = first;
  let anchorTime = frontierTime; // end of the last line placed with confidence
  let budget = MAX_AUDIO_FACTOR * durationSec - durationSec; // pass 0 heard the whole song once
  let windowNo = 0;
  const maxWindows = Math.ceil(durationSec / 10) + 5;
  while (frontier < lines.length && frontierTime < durationSec - 1 && windowNo < maxWindows) {
    windowNo += 1;
    const from = Math.max(0, frontierTime - BACKUP_SEC);
    const prompt = promptFor(lines.slice(frontier, frontier + NEXT_LINES));
    const span = expectedSpan(lines.length / durationSec, Math.min(durationSec, from + WINDOW_SEC) - anchorTime);
    const expected = expectedWords(lines.slice(Math.max(0, frontier - 1), frontier + span));
    const { got, records, spent, broke } = await hearWindow({ from, durationSec, budget, prompt, expected, transcribe, cutAudio, onProgress, windowNo });
    passes = [...passes, ...records];
    budget -= spent;
    if (broke) break;
    if (!got) { frontierTime = Math.min(durationSec, from + RETRY_SEC); continue; }
    heard = [...heard.filter((w) => w.start < frontierTime), ...got.words.filter((w) => w.start >= frontierTime)];
    if (got.to >= durationSec) break;
    const placed = placeLines(lines, heard, { durationSec });
    const last = lastReliable(placed, frontier);
    const lineTime = last >= frontier ? placed[last].end : -Infinity;
    const advanced = lineTime > frontierTime + MIN_ADVANCE_SEC;
    if (last >= frontier) frontier = last + 1;
    frontierTime = advanced ? lineTime : got.to - OVERLAP_SEC;
    if (advanced) anchorTime = lineTime;
    heard = heard.filter((w) => w.start < frontierTime + KEEP_AFTER_SEC);
  }
  return { heard, passes };
}
