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

const passRecord = (from, to, reason) => ({ from, to, status: reason ? "rejected" : "used", ...(reason ? { reason } : {}) });

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

/** One window from `from`, retried once narrower when its words are rejected. `got` is null when both tries were. */
async function hearWindow({ from, durationSec, prompt, expected, transcribe, cutAudio, onProgress, windowNo }) {
  const records = [];
  for (const len of [WINDOW_SEC, RETRY_SEC]) {
    const to = Math.min(durationSec, from + len);
    onProgress?.({ window: windowNo, from, to });
    const res = await transcribe(await cutAudio(from, to), prompt);
    const words = trimLoops(shift(res.words || [], from));
    const reason = rejectPass(words, expected);
    records.push(passRecord(from, to, reason));
    if (!reason) return { got: { words, to }, records };
  }
  return { got: null, records };
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
  let windowNo = 0;
  const maxWindows = Math.ceil(durationSec / 10) + 5;
  while (frontier < lines.length && frontierTime < durationSec - 1 && windowNo < maxWindows) {
    windowNo += 1;
    const from = Math.max(0, frontierTime - BACKUP_SEC);
    const prompt = promptFor(lines.slice(frontier, frontier + NEXT_LINES));
    // Anything still to come counts as expected: the singer may be further on than the frontier.
    const expected = expectedWords(lines.slice(Math.max(0, frontier - 1)));
    const { got, records } = await hearWindow({ from, durationSec, prompt, expected, transcribe, cutAudio, onProgress, windowNo });
    passes = [...passes, ...records];
    if (!got) { frontierTime = Math.min(durationSec, from + RETRY_SEC); continue; }
    heard = [...heard.filter((w) => w.start < frontierTime), ...got.words.filter((w) => w.start >= frontierTime)];
    if (got.to >= durationSec) break;
    const placed = placeLines(lines, heard, { durationSec });
    const last = lastReliable(placed, frontier);
    const lineTime = last >= frontier ? placed[last].end : -Infinity;
    const advanced = lineTime > frontierTime + MIN_ADVANCE_SEC;
    if (last >= frontier) frontier = last + 1;
    frontierTime = advanced ? lineTime : got.to - OVERLAP_SEC;
    heard = heard.filter((w) => w.start < frontierTime + KEEP_AFTER_SEC);
  }
  return { heard, passes };
}
