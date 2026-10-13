// server/src/lib/lyricVideo/align.js
/**
 * Puts the sheet's words on the song's clock: the sheet is matched word by
 * word against what Whisper heard (global alignment), heard words give their
 * times, the rest are spread between heard neighbours. Words always come from
 * the sheet, so spelling and Yoruba marks are never replaced by Whisper's.
 */
export const FLAG_CONFIDENCE = 0.6;
export const MAX_INTERP_GAP = 3;
const MIN_WORD = 0.08;
const RESPONSE_AFTER = 0.2;
const RESPONSE_PER_WORD = 0.25;
const RESPONSE_MIN = 0.7;
const TAIL_WORD = 0.3;

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

/** Needleman–Wunsch: match +2, mismatch −1, gap −1. Mismatch runs count only between matches. */
export function alignTokens(a, b) {
  const n = a.length;
  const m = b.length;
  const W = m + 1;
  const score = new Int32Array((n + 1) * W);
  const move = new Uint8Array((n + 1) * W); // 1 diag, 2 up (gap in b), 3 left (gap in a)
  for (let i = 1; i <= n; i += 1) { score[i * W] = -i; move[i * W] = 2; }
  for (let j = 1; j <= m; j += 1) { score[j] = -j; move[j] = 3; }
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const d = score[(i - 1) * W + j - 1] + (a[i - 1] === b[j - 1] ? 2 : -1);
      const u = score[(i - 1) * W + j] - 1;
      const l = score[i * W + j - 1] - 1;
      const best = Math.max(d, u, l);
      score[i * W + j] = best;
      move[i * W + j] = best === d ? 1 : best === u ? 2 : 3;
    }
  }
  const steps = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const mv = move[i * W + j];
    if (i > 0 && j > 0 && mv === 1) { steps.push({ t: a[i - 1] === b[j - 1] ? "M" : "S", i: i - 1, j: j - 1 }); i -= 1; j -= 1; }
    else if (i > 0 && (j === 0 || mv === 2)) { steps.push({ t: "D", i: i - 1 }); i -= 1; }
    else { steps.push({ t: "I", j: j - 1 }); j -= 1; }
  }
  steps.reverse();
  const map = new Array(n).fill(-1);
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

export function placeLines(lines, heard, { locked = new Map(), durationSec = Infinity } = {}) {
  const sortedHeard = [...heard].sort((x, y) => x.start - y.start);
  const tokens = tokenize(lines);
  const map = alignTokens(tokens.map((t) => t.norm), sortedHeard.map((h) => normWord(h.word)));
  // Per sheet word: heard start/end, how many parts, how many heard.
  const slots = lines.map((line) => wordsOf(line).map(() => ({ start: null, end: null, parts: 0, heard: 0 })));
  tokens.forEach((t, k) => {
    const slot = slots[t.line][t.word];
    slot.parts += 1;
    const j = map[k];
    if (j < 0) return;
    slot.heard += 1;
    if (slot.start === null) slot.start = sortedHeard[j].start;
    slot.end = sortedHeard[j].end;
  });
  lines.forEach((line, li) => {
    const lock = locked.get(line.id);
    if (!lock) return;
    lock.words.forEach((w, wi) => { if (slots[li][wi]) Object.assign(slots[li][wi], { start: w.start, end: w.end, heard: slots[li][wi].parts || 1, parts: slots[li][wi].parts || 1, locked: true }); });
  });
  const isUnheardResponse = (li) => lines[li].kind === "response" && !locked.has(lines[li].id) && slots[li].every((s) => s.start === null);
  // Flat order of the words that take part in interpolation.
  const flat = [];
  lines.forEach((line, li) => { if (!isUnheardResponse(li)) slots[li].forEach((s, wi) => flat.push({ li, wi, s })); });
  const gapFlag = new Set();
  let k = 0;
  while (k < flat.length) {
    if (flat[k].s.start !== null) { k += 1; continue; }
    let e = k; while (e < flat.length && flat[e].s.start === null) e += 1;
    const left = k > 0 ? flat[k - 1].s.start : null;
    const right = e < flat.length ? flat[e].s.start : null;
    const count = e - k;
    for (let q = 0; q < count; q += 1) {
      let t;
      if (left !== null && right !== null) t = left + ((right - left) * (q + 1)) / (count + 1);
      else if (right !== null) t = Math.max(0, right - TAIL_WORD * (count - q));
      else if (left !== null) t = Math.min(durationSec, left + TAIL_WORD * (q + 1));
      else t = TAIL_WORD * q;
      flat[k + q].s.start = t;
      flat[k + q].s.interp = true;
    }
    if (left === null || right === null || right - left > MAX_INTERP_GAP) for (let q = k; q < e; q += 1) gapFlag.add(flat[q].li);
    k = e;
  }
  for (let q = 1; q < flat.length; q += 1) {
    if (flat[q].s.start < flat[q - 1].s.start + MIN_WORD) flat[q].s.start = flat[q - 1].s.start + MIN_WORD;
  }
  const out = lines.map((line, li) => {
    const texts = wordsOf(line);
    const parts = slots[li].reduce((n, s) => n + s.parts, 0);
    const heardParts = slots[li].reduce((n, s) => n + s.heard, 0);
    return { ...line, texts, slots: slots[li], confidence: parts ? heardParts / parts : 0, gap: gapFlag.has(li) };
  });
  // Unheard responses: just after their call.
  out.forEach((l, li) => {
    if (!isUnheardResponse(li)) return;
    const call = [...out.slice(0, li)].reverse().find((x) => x.slots.length && x.slots[x.slots.length - 1].start !== null);
    const callLast = call ? call.slots[call.slots.length - 1] : null;
    const callEnd = callLast ? (callLast.end ?? callLast.start + TAIL_WORD) : 0;
    const len = Math.max(RESPONSE_MIN, RESPONSE_PER_WORD * l.texts.length);
    l.slots.forEach((s, wi) => { s.start = callEnd + RESPONSE_AFTER + (len * wi) / l.texts.length; s.respEnd = callEnd + RESPONSE_AFTER + len; });
  });
  const firstStartAfter = (li) => {
    for (let q = li + 1; q < out.length; q += 1) if (out[q].slots.length) return out[q].slots[0].start;
    return durationSec;
  };
  return out.map((l, li) => {
    const next = firstStartAfter(li);
    const words = l.slots.map((s, wi) => {
      const after = wi + 1 < l.slots.length ? l.slots[wi + 1].start : null;
      let end = after ?? (s.respEnd ?? (s.end && !s.interp ? s.end : s.start + TAIL_WORD));
      end = Math.min(end, Number.isFinite(next) ? next - 0.02 : end);
      end = Math.max(end, s.start + MIN_WORD);
      return { text: l.texts[wi], start: round(s.start), end: round(end) };
    });
    const overlap = words.length && Number.isFinite(next) && words[words.length - 1].end > next;
    const isLocked = locked.has(l.id);
    const flag = isLocked ? null : (l.confidence < FLAG_CONFIDENCE || l.gap || overlap ? "check" : null);
    const { texts, slots: _s, gap: _g, ...rest } = l;
    return {
      ...rest,
      words,
      start: words.length ? words[0].start : 0,
      end: words.length ? words[words.length - 1].end : 0,
      confidence: isLocked ? 1 : round(l.confidence),
      flag,
    };
  });
}

function round(n) { return Math.round(n * 100) / 100; }
