// server/src/lib/lyricVideo/transcribeWindows.js
import { placeLines, alignTokens, tokenize, normWord } from "./align.js";
import { trimLoops, rejectPass, promptFor, expectedFrom } from "./passQuality.js";

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
const MAX_SPAN = 24; // most lines a window is ever checked against
const LOCATE_LINES = 2 * MAX_SPAN; // how far past the frontier an accepted window is looked for
const MAX_AUDIO_FACTOR = 3; // all passes together send Whisper at most this many times the song's length

/**
 * Pass 0's reliable prefix: the last line heard with confidence before the
 * first run of RUN lines heard below LOW; -1 when the run starts at line 0.
 * Unheard responses are expected (they are rarely sung back clearly), so they
 * neither start nor break a run.
 */
function lastReliable(placed) {
  let last = -1;
  let run = 0;
  for (let i = 0; i < placed.length; i += 1) {
    const line = placed[i];
    if (line.confidence >= LOW) { last = i; run = 0; continue; }
    if (line.kind === "response") continue;
    run += 1;
    if (run >= RUN) break;
  }
  return last;
}

/** Matched heard words per sheet line (keyed by line offset) for one alignment. */
function lineHits(toks, map) {
  const byLine = new Map();
  toks.forEach((t, k) => {
    const entry = byLine.get(t.line) ?? { parts: 0, matched: [] };
    byLine.set(t.line, { parts: entry.parts + 1, matched: map[k] >= 0 ? [...entry.matched, map[k]] : entry.matched });
  });
  return byLine;
}

/**
 * Where a window's words sit in lines [lo, hi): each line in turn is tried as
 * the start, and the start that matches the most words wins (the earliest on a
 * tie). Returns the last line the window heard with confidence (absolute
 * index, -1 when none) and when that line's last heard word ended.
 *
 * Aligning only the window, from the best start, keeps a window's words on
 * the lines they belong to even when earlier lines were never heard; the
 * whole-sheet alignment would pay to skip those lines and pull the words onto
 * them instead.
 */
function locateWindow(lines, lo, hi, words) {
  const heardNorms = words.map((w) => normWord(w.word));
  let best = null;
  for (let s = lo; s < hi; s += 1) {
    const toks = tokenize(lines.slice(s, hi));
    const map = alignTokens(toks.map((t) => t.norm), heardNorms);
    const matches = map.filter((j) => j >= 0).length;
    if (!best || matches > best.matches) best = { s, toks, map, matches };
  }
  if (!best || !best.matches) return { last: -1, lastEnd: -Infinity };
  const sure = [...lineHits(best.toks, best.map)].filter(([, h]) => h.matched.length / h.parts >= LOW);
  if (!sure.length) return { last: -1, lastEnd: -Infinity };
  const [offset, hits] = sure[sure.length - 1];
  return { last: best.s + offset, lastEnd: Math.max(...hits.matched.map((j) => words[j].end)) };
}

function shift(words, by) {
  return words.map((w) => ({ word: w.word, start: w.start + by, end: w.end + by }));
}

/**
 * How many lines past the frontier a window's words may come from: the next
 * NEXT_LINES, or as many as the song could sing (at its average pace, with
 * slack) between the last confidently placed line and the window's end, never
 * more than MAX_SPAN. A window right after the frontier is held to the lines
 * its prompt names; one far past it (earlier windows heard nothing) may be
 * anywhere in that stretch. Bounded either way, so chatter cannot match the
 * whole sheet's vocabulary.
 */
function expectedSpan(linesPerSec, secsSinceAnchor) {
  const byPace = Math.ceil(Math.max(0, secsSinceAnchor) * linesPerSec * PACE_SLACK);
  return Math.min(MAX_SPAN, Math.max(NEXT_LINES, byPace));
}

const passRecord = (from, to, reason) => ({ from, to, status: reason ? "rejected" : "used", ...(reason ? { reason } : {}) });

/** Pass 0: the whole song, prompted with the sheet, kept only up to its reliable prefix (spec §5.3 steps 1–2). */
async function firstPass({ audioPath, durationSec, lines, transcribe }) {
  const res = await transcribe(audioPath, promptFor(lines));
  const words = trimLoops(res.words || []);
  const reason = rejectPass(words, expectedFrom(lines));
  const pass = passRecord(0, durationSec, reason);
  if (reason) return { pass, heard: [], frontier: 0, frontierTime: 0 };
  const placed = placeLines(lines, words, { durationSec });
  const last = lastReliable(placed);
  const frontierTime = last >= 0 ? placed[last].end : 0;
  return { pass, heard: words.filter((w) => w.start < frontierTime + KEEP_AFTER_SEC), frontier: last + 1, frontierTime };
}

/**
 * One window from `from`, retried once narrower when its words are rejected.
 * A try that would go over `budget` seconds of audio is skipped (so a 15 s
 * try may still run when 30 s no longer fits). `got` is null when no try was
 * used; `spent` is the audio sent; `broke` says no try fitted the budget.
 */
async function hearWindow({ from, durationSec, budget, prompt, expected, transcribe, cutAudio, onProgress, windowNo }) {
  const records = [];
  let spent = 0;
  for (const len of [WINDOW_SEC, RETRY_SEC]) {
    const to = Math.min(durationSec, from + len);
    if (spent + (to - from) > budget) continue;
    onProgress?.({ window: windowNo, from, to });
    const res = await transcribe(await cutAudio(from, to), prompt);
    spent += to - from;
    const words = trimLoops(shift(res.words || [], from));
    const reason = rejectPass(words, expected);
    records.push(passRecord(from, to, reason));
    if (!reason) return { got: { words, to }, records, spent, broke: false };
  }
  return { got: null, records, spent, broke: records.length === 0 };
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
    const expected = expectedFrom(lines.slice(Math.max(0, frontier - 1), frontier + span));
    const { got, records, spent, broke } = await hearWindow({ from, durationSec, budget, prompt, expected, transcribe, cutAudio, onProgress, windowNo });
    passes = [...passes, ...records];
    budget -= spent;
    if (broke) break;
    if (!got) { frontierTime = Math.min(durationSec, from + RETRY_SEC); continue; }
    heard = [...heard.filter((w) => w.start < frontierTime), ...got.words.filter((w) => w.start >= frontierTime)];
    if (got.to >= durationSec) break;
    const lo = Math.max(0, frontier - 1);
    const { last, lastEnd } = locateWindow(lines, lo, Math.min(lines.length, lo + LOCATE_LINES), got.words);
    const lineTime = last >= frontier ? lastEnd : -Infinity;
    const advanced = lineTime > frontierTime + MIN_ADVANCE_SEC;
    if (last >= frontier) frontier = last + 1;
    frontierTime = advanced ? lineTime : got.to - OVERLAP_SEC;
    if (advanced) anchorTime = lineTime;
    heard = heard.filter((w) => w.start < frontierTime + KEEP_AFTER_SEC);
  }
  return { heard, passes };
}
