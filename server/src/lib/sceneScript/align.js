import { numberToWords, speakableText } from "./speech.js";
import { referenceOfLine } from "./reference.js";

const norm = (s) => String(s ?? "").normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]/gu, "");
const tokensOf = (text) => String(text || "").split(/\s+/u).filter(Boolean);

/** Synthetic utility, never a native-alignment fallback. */
export function spreadWords(text, durSec) {
  const words = tokensOf(text);
  const duration = Number.isFinite(durSec) && durSec > 0 ? durSec : 0;
  const total = words.reduce((n, w) => n + Math.max(1, norm(w).length), 0) || 1;
  let time = 0;
  return words.map((text, i) => {
    const start = time;
    time += duration * Math.max(1, norm(text).length) / total;
    return { text, start, end: i === words.length - 1 ? duration : time };
  });
}

/** Only map known printed layouts, checked against the actual speech helper. */
function targetsFor(text, kind, heard) {
  const words = tokensOf(text), targets = words.map((w) => [norm(w)]);
  if (kind !== "reference") return targets;
  const ref = referenceOfLine(text);
  const m = /^(.*?)\s+(\d+(?::\d+(?:[-–]\d+)?)?)[.!?]?$/u.exec(String(text).trim());
  if (!ref || !m) return targets;
  const printedBook = tokensOf(m[1]), canonicalBook = tokensOf(ref.book);
  if (printedBook.length !== canonicalBook.length || printedBook.some((w, i) =>
    norm(w) !== norm(canonicalBook[i]) && !(norm(w) === "psalm" && norm(canonicalBook[i]) === "psalms"))) return targets;
  const ordinal = { 1: "First", 2: "Second", 3: "Third" };
  const book = canonicalBook.map((w, i) => i === 0 && ordinal[w] ? ordinal[w] : w);
  const chapter = numberToWords(ref.chapter), range = ref.verseTo && ref.verseTo !== ref.verseFrom;
  const verse = ref.verseFrom ? `, verse${range ? "s" : ""} ${numberToWords(ref.verseFrom)}${range ? ` to ${numberToWords(ref.verseTo)}` : ""}` : "";
  const suffix = `chapter ${chapter}${verse}`;
  if (norm(`${book.join(" ")} ${suffix}`) !== norm(speakableText({ text, kind }))) return targets;
  book.forEach((w, i) => { targets[i] = [norm(w)]; });
  if (norm(m[1]) === "psalm" && norm(ref.book) === "psalms") targets[0].push("psalm");
  targets[words.length - 1] = [norm(suffix)];
  // Known number-only variant is safe but explicitly reported as incomplete
  // coverage of the expected spoken expansion (missing chapter label).
  if (!ref.verseFrom && !heard.some((h) => norm(h?.text) === "chapter")) targets[words.length - 1].push(norm(chapter));
  return targets;
}

/**
 * Preserve author text and native anchors. Unresolved words get zero-width
 * compatibility placeholders, NOT measured windows. Only one short bracketed
 * omission may be estimated. Native means provider data, not acoustic QA.
 */
export function alignCaption(text, heard, durSec, { kind } = {}) {
  const words = tokensOf(text), targets = targetsFor(text, kind, Array.isArray(heard) ? heard : []), warnings = [];
  const duration = Number.isFinite(durSec) && durSec > 0 ? durSec : 0;
  if (!duration) warnings.push({ code: "invalid-duration" });
  if (!Array.isArray(heard)) warnings.push({ code: "invalid-boundaries" });
  const native = [];
  let previousEnd = 0;
  (Array.isArray(heard) ? heard : []).forEach((h, sourceIndex) => {
    if (!h || typeof h.text !== "string" || !Number.isFinite(h.start) || !Number.isFinite(h.end)
      || h.start < 0 || h.end <= h.start || h.end > duration || h.start < previousEnd) {
      warnings.push({ code: "invalid-boundary", sourceIndex }); return;
    }
    previousEnd = h.end;
    if (norm(h.text)) native.push({ ...h, sourceIndex, key: norm(h.text) });
  });
  const n = words.length, m = native.length;
  const matches = Array.from({ length: n }, () => new Map());
  if (n > 500 || m > 500) {
    warnings.push({ code: "alignment-size-limit" });
    return { words: words.map((text) => ({ text, start: 0, end: 0 })), timing: { version: 1, quality: "unresolved", source: "provider-word-boundaries", text: String(text || ""), durationSec: duration, tokens: words.map((text, index) => ({ index, text, provenance: "unresolved", reason: "alignment-size-limit", start: 0, end: 0 })), warnings } };
  }
  for (let i = 0; i < n; i += 1) for (let j = 0; j < m; j += 1) {
    if (!norm(words[i])) continue;
    let got = "";
    for (let k = j; k < m && k < j + 16; k += 1) {
      if (k > j && native[k].sourceIndex !== native[k - 1].sourceIndex + 1) break;
      got += native[k].key;
      if (targets[i].includes(got)) {
        const ends = matches[i].get(j) || [];
        ends.push(k + 1); matches[i].set(j, ends);
      }
      if (!targets[i].some((t) => t.startsWith(got))) break;
    }
  }
  // Trust only assignments common to EVERY optimal sequence alignment.
  // This retains later anchors without choosing an arbitrary repeated word.
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) for (let j = m; j >= 0; j -= 1) {
    let best = dp[i + 1][j];
    if (j < m) best = Math.max(best, dp[i][j + 1]);
    for (const end of matches[i].get(j) || []) best = Math.max(best, 1 + dp[i + 1][end]);
    dp[i][j] = best;
  }
  const candidates = Array.from({ length: n }, () => new Set());
  const seen = new Set(), stack = [[0, 0]];
  while (stack.length) {
    const [i, j] = stack.pop(), key = i * (m + 1) + j;
    if (seen.has(key) || i === n) continue;
    seen.add(key);
    if (dp[i][j] === dp[i + 1][j]) { candidates[i].add("missing"); stack.push([i + 1, j]); }
    if (j < m && dp[i][j] === dp[i][j + 1]) stack.push([i, j + 1]);
    for (const end of matches[i].get(j) || []) if (dp[i][j] === 1 + dp[i + 1][end]) {
      candidates[i].add(`${j}:${end}`); stack.push([i + 1, end]);
    }
  }
  const used = new Set();
  const ledger = words.map((text, index) => {
    const c = candidates[index];
    if (c.size === 1 && !c.has("missing")) {
      const [from, to] = [...c][0].split(":").map(Number), boundaries = native.slice(from, to);
      boundaries.forEach((h) => used.add(h.sourceIndex));
      if (boundaries.map((h) => h.key).join("") !== targets[index][0]) warnings.push({ code: "reference-boundary-variant", tokenIndex: index });
      return { index, text, provenance: boundaries.map((h) => h.key).join("") === norm(text) ? "native" : "reference-native", start: boundaries[0].start, end: boundaries.at(-1).end, sourceIndices: boundaries.map((h) => h.sourceIndex) };
    }
    return { index, text, provenance: norm(text) ? "unresolved" : "nonspoken", reason: c.size > 1 ? "ambiguous-match" : "missing-boundary" };
  });
  const anchors = ledger.filter((t) => t.start !== undefined);
  // Use original unresolved states throughout, not mutations from earlier tokens.
  const unresolvedIndices = new Set(ledger.filter((t) => t.provenance === "unresolved").map((t) => t.index));
  for (const token of ledger) {
    if (token.start !== undefined) continue;
    const left = anchors.findLast((a) => a.index < token.index), right = anchors.find((a) => a.index > token.index);
    const gap = left && right ? right.start - left.end : 0;
    const missing = left && right ? [...unresolvedIndices].filter((i) => i > left.index && i < right.index) : [];
    if (token.provenance === "unresolved" && token.reason !== "ambiguous-match" && missing.length === 1 && gap >= 0.05 && gap <= 1.5
      && !native.some((h) => !used.has(h.sourceIndex) && h.start >= left.end && h.end <= right.start)) {
      Object.assign(token, { provenance: "estimated", reason: "short-bracketed-gap", start: left.end, end: right.start });
    } else token.start = token.end = Math.max(left?.end ?? right?.start ?? 0, ledger[token.index - 1]?.end ?? 0);
  }
  for (const t of ledger) if (["estimated", "unresolved"].includes(t.provenance)) warnings.push({ code: t.provenance, tokenIndex: t.index, reason: t.reason });
  for (const h of native) if (!used.has(h.sourceIndex)) warnings.push({ code: "unmatched-boundary", sourceIndex: h.sourceIndex });
  if (words.some((w) => norm(w)) && !native.length) warnings.push({ code: "no-native-boundaries" });
  const quality = ledger.some((t) => t.provenance === "unresolved") || warnings.some((w) => w.code !== "estimated") ? "unresolved"
    : ledger.some((t) => t.provenance === "estimated") ? "estimated" : "native";
  return { words: ledger.map(({ text, start, end }) => ({ text, start, end })), timing: { version: 1, quality, source: "provider-word-boundaries", text: String(text || ""), durationSec: duration, tokens: ledger, warnings } };
}

/** Compatibility API. New callers must persist the provenance ledger too. */
export const alignWords = (text, heard, durSec, options) => alignCaption(text, heard, durSec, options).words;
