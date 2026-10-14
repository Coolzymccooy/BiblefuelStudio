// server/src/lib/lyricVideo/align.js
/**
 * Puts the sheet's words on the song's clock: the sheet is matched word by
 * word against what Whisper heard (global alignment), heard words give their
 * times, the rest are spread between heard neighbours. Words always come from
 * the sheet, so spelling and Yoruba marks are never replaced by Whisper's.
 *
 * Locked lines are fixed anchors: they keep their words and times exactly,
 * and the lines between two locks are matched only against the heard words
 * that fall between them.
 */
export const FLAG_CONFIDENCE = 0.6;
export const MAX_INTERP_GAP = 3;
const MIN_WORD = 0.08; // shortest a word lasts when there is room
const STEP = 0.01; // smallest gap between two starts (interpolated words may be squeezed this tight)
const MOVE_TOL = 0.1; // a heard word nudged further than this flags its line
const RESPONSE_AFTER = 0.2;
const RESPONSE_PER_WORD = 0.25;
const RESPONSE_MIN = 0.7;
const TAIL_WORD = 0.3;
const RESPONSE_MATCH = 1.75; // responses are rarely sung back, so a lead wins a tie for heard words

export function normWord(w) {
  return String(w).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z0-9']/g, "");
}

export function tokenize(lines) {
  const out = [];
  lines.forEach((line, li) => {
    String(line.text).trim().split(/\s+/).forEach((word, wi) => {
      for (const part of word.split("-")) {
        const norm = normWord(part);
        if (norm) out.push({ line: li, word: wi, norm });
      }
    });
  });
  return out;
}

/**
 * Needleman–Wunsch: match +2, mismatch −1, gap −1, except that sheet words
 * left over after the last heard word cost nothing (the song may simply not
 * have been heard that far). Ties go to the earlier sheet word, so a repeated
 * phrase is matched to its first occurrence. Mismatch runs count only between
 * matches.
 *
 * `matchScores` (optional, one per sheet word, default 2) lets the caller make
 * some sheet words, such as unsung responses, slightly less eager to match.
 *
 * The free tail would make the last heard word cheap to drop, so that word
 * keeps its match when one exists within END_SLACK of the best score.
 */
const END_SLACK = 3;
export function alignTokens(a, b, matchScores = null) {
  const n = a.length;
  const m = b.length;
  const W = m + 1;
  const score = new Float64Array((n + 1) * W);
  const move = new Uint8Array((n + 1) * W); // 1 diag, 2 up (skip a sheet word), 3 left (skip a heard word)
  for (let i = 1; i <= n; i += 1) { score[i * W] = -i; move[i * W] = 2; }
  for (let j = 1; j <= m; j += 1) { score[j] = -j; move[j] = 3; }
  for (let i = 1; i <= n; i += 1) {
    const hit = matchScores ? matchScores[i - 1] : 2;
    for (let j = 1; j <= m; j += 1) {
      const d = score[(i - 1) * W + j - 1] + (a[i - 1] === b[j - 1] ? hit : -1);
      const u = score[(i - 1) * W + j] - 1;
      const l = score[i * W + j - 1] - 1;
      const best = Math.max(d, u, l);
      score[i * W + j] = best;
      move[i * W + j] = best === u ? 2 : best === d ? 1 : 3;
    }
  }
  return readMatches(a, b, move, W, chooseEnd(a, b, score, W));
}

/** Row where the alignment stops: the earliest best one, preferring a row that matches the last heard word. */
function chooseEnd(a, b, score, W) {
  const m = b.length;
  let best = 0;
  let anchored = -1;
  for (let i = 1; i <= a.length; i += 1) {
    const s = score[i * W + m];
    if (s > score[best * W + m]) best = i;
    if (m > 0 && a[i - 1] === b[m - 1] && (anchored < 0 || s > score[anchored * W + m])) anchored = i;
  }
  return anchored >= 0 && score[anchored * W + m] >= score[best * W + m] - END_SLACK ? anchored : best;
}

function traceSteps(a, b, move, W, iEnd) {
  const steps = [];
  let i = iEnd;
  let j = b.length;
  while (i > 0 || j > 0) {
    const mv = move[i * W + j];
    if (i > 0 && j > 0 && mv === 1) { steps.push({ t: a[i - 1] === b[j - 1] ? "M" : "S", i: i - 1, j: j - 1 }); i -= 1; j -= 1; }
    else if (i > 0 && (j === 0 || mv === 2)) { steps.push({ t: "D", i: i - 1 }); i -= 1; }
    else { steps.push({ t: "I", j: j - 1 }); j -= 1; }
  }
  return steps.reverse();
}

/** Matches map straight across; a mismatch counts only inside a run bordered by matches on both sides. */
function readMatches(a, b, move, W, iEnd) {
  const steps = traceSteps(a, b, move, W, iEnd);
  const map = new Array(a.length).fill(-1);
  for (let k = 0; k < steps.length; k += 1) {
    const s = steps[k];
    if (s.t === "M") { map[s.i] = s.j; continue; }
    if (s.t !== "S") continue;
    let a0 = k; while (a0 > 0 && steps[a0 - 1].t === "S") a0 -= 1;
    let b0 = k; while (b0 < steps.length - 1 && steps[b0 + 1].t === "S") b0 += 1;
    const before = a0 > 0 && steps[a0 - 1].t === "M";
    const after = b0 < steps.length - 1 && steps[b0 + 1].t === "M";
    if (before && after) map[s.i] = s.j;
  }
  return map;
}

function wordsOf(line) {
  return String(line.text).trim().split(/\s+/);
}

function round(n) { return Math.round(n * 1000) / 1000; }
function round2(n) { return Math.round(n * 100) / 100; }

const emptySlot = () => ({ start: null, end: null, parts: 0, heard: 0, kind: "gap", heardStart: null });

/** A lock only counts when it carries words. */
function lockOf(locked, line) {
  const lock = locked.get(line.id);
  return lock && Array.isArray(lock.words) && lock.words.length ? lock : null;
}

/** Runs of unlocked lines between locks, with the times of the locks either side. */
function findSegments(lines, locked) {
  const segments = [];
  let from = 0;
  let lo = null;
  lines.forEach((line, li) => {
    const lock = lockOf(locked, line);
    if (!lock) return;
    if (li > from) segments.push({ from, to: li, lo, hi: lock.words[0].start });
    from = li + 1;
    lo = lock.words[lock.words.length - 1].end;
  });
  if (from < lines.length) segments.push({ from, to: lines.length, lo, hi: null });
  return segments;
}

/** Match each segment's sheet words to the heard words that fall inside it. */
function alignSegments(lines, segments, sortedHeard) {
  const slots = lines.map((line) => wordsOf(line).map(emptySlot));
  for (const seg of segments) {
    const tokens = tokenize(lines.slice(seg.from, seg.to));
    const pool = sortedHeard.filter((h) => (seg.lo === null || h.start >= seg.lo) && (seg.hi === null || h.start < seg.hi));
    const scores = tokens.map((t) => (lines[seg.from + t.line].kind === "response" ? RESPONSE_MATCH : 2));
    const map = alignTokens(tokens.map((t) => t.norm), pool.map((h) => normWord(h.word)), scores);
    tokens.forEach((t, k) => {
      const slot = slots[seg.from + t.line][t.word];
      slot.parts += 1;
      const j = map[k];
      if (j < 0) return;
      slot.heard += 1;
      slot.kind = "heard";
      if (slot.start === null) { slot.start = pool[j].start; slot.heardStart = pool[j].start; }
      slot.end = pool[j].end;
    });
  }
  return slots;
}

/** One entry per line: its words, its slots (locked lines carry their own), and whether it is an unheard response. */
function buildPlan(lines, alignedSlots, locked) {
  return lines.map((line, li) => {
    const lock = lockOf(locked, line);
    if (lock) {
      return {
        line, locked: true, unheard: false, gap: false,
        texts: lock.words.map((w) => w.text),
        slots: lock.words.map((w) => ({ start: w.start, end: w.end, parts: 1, heard: 1, kind: "locked", heardStart: w.start })),
        lockWords: lock.words,
      };
    }
    const slots = alignedSlots[li];
    const unheard = line.kind === "response" && slots.every((s) => s.start === null);
    return { line, locked: false, unheard, gap: false, texts: wordsOf(line), slots, lockWords: null };
  });
}

/**
 * The latest time each line may reach: the audible end, except after a lock
 * that the user placed past it, where only the song's length bounds the lines
 * (they cannot go back before the lock without changing the order).
 */
function lineBounds(plan, audibleEnd, durationSec) {
  let pastLock = false;
  return plan.map((p) => {
    if (p.locked && p.lockWords[p.lockWords.length - 1].end > audibleEnd) pastLock = true;
    return pastLock ? durationSec : audibleEnd;
  });
}

/** Give unheard words times, spread between their placed neighbours. Returns the line indexes crossed over a long or open gap. */
function interpolate(flat, bounds) {
  const gapLines = new Set();
  let k = 0;
  while (k < flat.length) {
    if (flat[k].slot.start !== null) { k += 1; continue; }
    let e = k;
    while (e < flat.length && flat[e].slot.start === null) e += 1;
    const prev = k > 0 ? flat[k - 1].slot : null;
    const left = prev ? (prev.kind === "locked" ? prev.end : prev.start) : null;
    const right = e < flat.length ? flat[e].slot.start : null;
    // A neighbour past the bound (a late lock, a word heard in the silence) does not stretch the run past it.
    const room = right === null ? null : Math.max(left ?? 0, Math.min(right, bounds[k]));
    spreadRun(flat.slice(k, e).map((f) => f.slot), left, room, bounds[k]);
    if (left === null || right === null || right - left > MAX_INTERP_GAP) for (let q = k; q < e; q += 1) gapLines.add(flat[q].li);
    k = e;
  }
  return gapLines;
}

function spreadRun(run, left, right, durationSec) {
  const count = run.length;
  const times = run.map((_, q) => {
    if (left !== null && right !== null) return left + ((right - left) * (q + 1)) / (count + 1);
    if (right !== null) return Math.max(0, right - Math.min(TAIL_WORD, right / count) * (count - q));
    if (left !== null) return left + Math.max(0, Math.min(TAIL_WORD, (durationSec - left) / (count + 1))) * (q + 1);
    return Math.min(TAIL_WORD, durationSec / count) * q;
  });
  run.forEach((slot, q) => { slot.start = times[q]; slot.kind = "interp"; });
}

const gapNeeded = (prev, cur) => (prev.kind === "interp" || cur.kind === "interp" ? STEP : MIN_WORD);

/**
 * Starts strictly increase and stay inside their bound (one per slot). Locked
 * words never move, and nothing is pulled back before a lock that precedes it;
 * interpolated words are squeezed before a heard word is pushed.
 */
function enforceOrder(slots, bounds, { reserves = [], leadIn = 0 } = {}) {
  const keep = (q) => reserves[q] || 0; // room kept after slot q for the unheard responses that follow it
  if (slots.length && slots[0].kind !== "locked" && slots[0].start < leadIn) slots[0].start = leadIn;
  for (let q = 1; q < slots.length; q += 1) {
    const need = slots[q - 1].start + gapNeeded(slots[q - 1], slots[q]) + keep(q - 1);
    if (slots[q].kind !== "locked" && slots[q].start < need) slots[q].start = need;
  }
  if (!bounds.some(Number.isFinite)) return;
  // The earliest a word may sit: after the end of the last lock before it, a step per word since.
  let floor = leadIn - STEP;
  const floors = slots.map((s) => { floor = s.kind === "locked" ? s.end : floor + STEP; return floor; });
  for (let q = slots.length - 1; q >= 0; q -= 1) {
    if (slots[q].kind === "locked") continue;
    const own = bounds[q] - STEP - keep(q);
    const upper = q === slots.length - 1 ? own : Math.min(own, slots[q + 1].start - gapNeeded(slots[q], slots[q + 1]) - keep(q));
    if (slots[q].start > upper) slots[q].start = Math.max(0, upper, floors[q]);
  }
}

/** A word's natural end when nothing follows it in its line. */
function tailEnd(slot) {
  if (slot.kind === "heard" && slot.end !== null && slot.end > slot.start) return slot.end;
  return slot.start + (slot.kind === "heard" ? MIN_WORD : TAIL_WORD);
}

/** Latest a line may end: just before the next line, and never past its bound. */
function lineCap(lastStart, nextStart, bound) {
  if (nextStart === null) return bound;
  return Math.min(bound, nextStart - lastStart > 0.04 ? nextStart - 0.02 : lastStart + (nextStart - lastStart) / 2);
}

function lineWords(plan, nextStart, bound) {
  if (plan.locked) return plan.lockWords.map((w) => ({ ...w }));
  const { slots, texts } = plan;
  const cap = lineCap(slots[slots.length - 1].start, nextStart, bound);
  return slots.map((s, wi) => {
    const natural = wi + 1 < slots.length ? slots[wi + 1].start : tailEnd(s);
    const end = Math.min(Math.max(natural, s.start + MIN_WORD), cap);
    return { text: texts[wi], start: round(s.start), end: round(Math.max(end, s.start + STEP / 2)) };
  });
}

/** Does the line's last heard word run on into the next line, or has a heard word been pushed off its time? */
function hasConflict(plan, nextStart) {
  if (plan.locked) return false;
  const last = plan.slots[plan.slots.length - 1];
  const overlap = nextStart !== null && (last.kind === "heard" ? Math.max(tailEnd(last), last.start + MIN_WORD) : last.start + MIN_WORD) > nextStart + MOVE_TOL;
  const moved = plan.slots.some((s) => s.kind === "heard" && Math.abs(s.start - s.heardStart) > MOVE_TOL);
  return overlap || moved;
}

const MIN_FIT = 0.01; // tightest squeeze of a response run

/** Lengths of a run of unheard responses (from li up to the next placed line) and their full span. */
function responseRun(plan, li) {
  let end = li;
  while (end < plan.length && plan[end].unheard) end += 1;
  const lens = plan.slice(li, end).map((p) => Math.max(RESPONSE_MIN, RESPONSE_PER_WORD * p.texts.length));
  return { end, lens, span: lens.reduce((sum, len) => sum + RESPONSE_AFTER + len, 0) };
}

/** Room each line keeps after it for the unheard responses that follow (their tightest squeeze), and before the first line. */
function responseRoom(plan) {
  const after = plan.map((p, li) => (li + 1 < plan.length && plan[li + 1].unheard && !p.unheard ? responseRun(plan, li + 1).span * MIN_FIT : 0));
  const leadIn = plan.length && plan[0].unheard ? responseRun(plan, 0).span * MIN_FIT : 0;
  return { after, leadIn };
}

/**
 * Where a run of responses may start: the end of its call. When the call
 * already reaches the next line or the bound (a squeezed tail), its last word
 * is shortened to share the room, so the responses still end in time.
 */
function makeRoom(plan, words, li, nextStart, need) {
  if (li === 0) return 0;
  const call = words[li - 1];
  const last = call[call.length - 1];
  if (nextStart - last.end >= need || plan[li - 1].locked || !Number.isFinite(nextStart)) return last.end;
  const shared = round(Math.min(last.end, Math.max(last.start + STEP / 10, nextStart - need)));
  call[call.length - 1] = { ...last, end: Math.max(shared, last.start + STEP / 10) };
  return call[call.length - 1].end;
}

/** Unheard responses go just after their call, squeezed to fit before the next line (and inside their bound). */
function placeResponses(plan, words, bounds) {
  let li = 0;
  while (li < plan.length) {
    if (!plan[li].unheard) { li += 1; continue; }
    const { end, lens, span } = responseRun(plan, li);
    const nextStart = Math.min(end < plan.length ? words[end][0].start : Infinity, bounds[li]);
    const callEnd = makeRoom(plan, words, li, nextStart, span * MIN_FIT);
    const room = nextStart - callEnd;
    // Squeezed to the room that is left; a lock that leaves none gets the tightest squeeze.
    const fit = room > 0 ? Math.min(1, room / span) : MIN_FIT;
    let cursor = callEnd;
    for (let q = li; q < end; q += 1) {
      const len = lens[q - li] * fit;
      const start = cursor + RESPONSE_AFTER * fit;
      const n = plan[q].texts.length;
      words[q] = plan[q].texts.map((text, wi) => ({
        text,
        start: round(start + (len * wi) / n),
        end: round(start + (len * (wi + 1)) / n),
      }));
      cursor = start + len;
    }
    li = end;
  }
}

function assemble(plan, words, gapLines) {
  return plan.map((p, li) => {
    const nextStart = nextPlacedStart(plan, words, li);
    const heardParts = p.slots.reduce((n, s) => n + s.heard, 0);
    const parts = p.slots.reduce((n, s) => n + s.parts, 0);
    const confidence = p.locked ? 1 : parts ? heardParts / parts : 0;
    const check = !p.locked && (confidence < FLAG_CONFIDENCE || gapLines.has(li) || hasConflict(p, nextStart));
    return {
      ...p.line,
      words: words[li],
      start: words[li][0].start,
      end: words[li][words[li].length - 1].end,
      confidence: p.locked ? 1 : round2(confidence),
      flag: check ? "check" : null,
    };
  });
}

function nextPlacedStart(plan, words, li) {
  for (let q = li + 1; q < plan.length; q += 1) if (!plan[q].unheard) return words[q][0].start;
  return null;
}

/**
 * `durationSec` is the song's length; `audibleEnd` (default: the length) is
 * where the music stops, and no line is placed after it. A lock the user put
 * past the audible end is kept, and the lines after it are bounded by the
 * song's length instead.
 */
export function placeLines(lines, heard, { locked = new Map(), durationSec = Infinity, audibleEnd = durationSec } = {}) {
  const endSec = Number.isFinite(audibleEnd) && audibleEnd > 0 ? Math.min(audibleEnd, durationSec) : durationSec;
  const sortedHeard = [...heard].sort((x, y) => x.start - y.start);
  const alignedSlots = alignSegments(lines, findSegments(lines, locked), sortedHeard);
  const plan = buildPlan(lines, alignedSlots, locked);
  const bounds = lineBounds(plan, endSec, durationSec);
  const flat = plan.flatMap((p, li) => (p.unheard ? [] : p.slots.map((slot) => ({ li, slot }))));
  const slotBounds = flat.map((f) => bounds[f.li]);
  const room = responseRoom(plan);
  const reserves = flat.map((f, q) => (q + 1 === flat.length || flat[q + 1].li !== f.li ? room.after[f.li] : 0));
  const gapLines = interpolate(flat, slotBounds);
  enforceOrder(flat.map((f) => f.slot), slotBounds, { reserves, leadIn: room.leadIn });
  const words = plan.map((p, li) => (p.unheard ? null : lineWords(p, nextPlacedStartRaw(plan, li), bounds[li])));
  placeResponses(plan, words, bounds);
  return assemble(plan, words, gapLines);
}

/** Start of the next line that has a real place (not an unheard response), from the slot times. */
function nextPlacedStartRaw(plan, li) {
  for (let q = li + 1; q < plan.length; q += 1) if (!plan[q].unheard) return plan[q].slots[0].start;
  return null;
}
