/**
 * Which effect each line gets, from its section and its shape (spec §6.1).
 * Effects are forced into the engine's plan, and forced choices skip the
 * engine's own checks, so this keeps its spacing rules itself: slams 4 s
 * apart and at most 4 words, a frame every 30 s, a curve every 20 s, and
 * only pop/stack past 5 words.
 */
import { mulberry32 } from "../kinetic/director.js";

const SLAM_GAP = 4;
const FRAME_GAP = 30;
const CURVE_GAP = 20;
const SLAM_MAX_WORDS = 4;
const SHORT_WORDS = 5;
/** Calm's pools are pop and stack, so every other move steps down to one of them (a line's own choice is kept). */
const CALM_STEP = Object.freeze({ slam: "pop", frame: "stack", curve: "stack", quote: "stack", title: "pop" });
/** Pop and quote sit in the lower band, where an echo is drawn (§6.2). */
const LOWER_BAND = new Set(["pop", "quote"]);

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
const wordCount = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;
const isQuotation = (s) => /["“”]/.test(s);

/** Indexes of the hook lines: those holding the song title, else the most repeated chorus line. */
export function titleLineIndexes(lines, title, sections) {
  const hookSections = new Set(sections.filter((s) => s.kind === "chorus" || s.kind === "final").map((s) => s.id));
  const wanted = norm(title);
  const byTitle = new Set();
  lines.forEach((l, i) => { if (wanted && hookSections.has(l.sectionId) && norm(l.text).includes(wanted)) byTitle.add(i); });
  if (byTitle.size) return byTitle;
  const counts = new Map();
  lines.forEach((l) => {
    if (hookSections.has(l.sectionId)) counts.set(norm(l.text), (counts.get(norm(l.text)) || 0) + 1);
  });
  const top = [...counts.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1])[0]?.[0];
  const out = new Set();
  if (top) lines.forEach((l, i) => { if (hookSections.has(l.sectionId) && norm(l.text) === top) out.add(i); });
  return out;
}

/**
 * Whether line i is directly followed by response lines that will all be drawn as echoes: each
 * one left on Auto (a response's Auto is always echo) or set to Echo.
 */
function repliesEcho(lines, i) {
  let j = i + 1;
  for (; lines[j]?.kind === "response"; j++) {
    const { effect } = lines[j];
    if (effect && effect !== "auto" && effect !== "echo") return false;
  }
  return j > i + 1;
}

/** First and last line index of each section. */
function sectionBounds(lines) {
  const first = new Map();
  const last = new Map();
  lines.forEach((l, i) => {
    if (!first.has(l.sectionId)) first.set(l.sectionId, i);
    last.set(l.sectionId, i);
  });
  return { first, last };
}

/** For each pre-chorus section, the line of at most 5 words nearest its middle. */
function preCurveLines(lines, kindOf, first, last) {
  const pick = new Map();
  first.forEach((from, sid) => {
    if (kindOf.get(sid) !== "pre") return;
    const middle = (from + last.get(sid)) / 2;
    let best = -1;
    for (let i = from; i <= last.get(sid); i += 1) {
      if (lines[i].sectionId !== sid || wordCount(lines[i].text) > SHORT_WORDS) continue;
      if (best < 0 || Math.abs(i - middle) < Math.abs(best - middle)) best = i;
    }
    if (best >= 0) pick.set(sid, best);
  });
  return pick;
}

/**
 * One effect id per line (spec §6.1). `energy` is the project's energy id: "lively" has no frames,
 * "calm" keeps only pop and stack. `seed` picks whether each section's stack/pop alternation starts
 * on stack (seed 1, the default) or pop; it never changes a line's own choice. Pure and deterministic.
 */
export function chooseEffects({ lines, sections, title, energy, seed = 1 }) {
  const kindOf = new Map(sections.map((s) => [s.id, s.kind]));
  const titleLines = titleLineIndexes(lines, title, sections);
  const { first, last } = sectionBounds(lines);
  const preCurve = preCurveLines(lines, kindOf, first, last);
  const seedNo = Math.floor(Number(seed)) || 1;
  const rnd = mulberry32(seedNo);
  // One draw per section, on first sight in line order, so one section's roll never shifts another's.
  const firstFx = new Map();
  const alternation = new Map();
  const flip = (sid) => {
    const n = (alternation.get(sid) || 0) + 1;
    alternation.set(sid, n);
    const start = firstFx.get(sid);
    return n % 2 === 1 ? start : start === "stack" ? "pop" : "stack";
  };
  const framed = new Set();
  const curved = new Set();
  let lastSlamEnd = -Infinity;
  let lastFrame = -Infinity;
  let lastCurve = -Infinity;

  return lines.map((l, i) => {
    if (!firstFx.has(l.sectionId)) {
      const roll = rnd();
      firstFx.set(l.sectionId, seedNo === 1 || roll < 0.5 ? "stack" : "pop");
    }
    const words = wordCount(l.text);
    const kind = kindOf.get(l.sectionId) || "other";
    const own = l.effect && l.effect !== "auto";
    const canSlam = words <= SLAM_MAX_WORDS && l.start - lastSlamEnd >= SLAM_GAP;
    const canCurve = words <= SHORT_WORDS && l.start - lastCurve >= CURVE_GAP && !curved.has(l.sectionId);
    let fx;
    if (own) fx = l.effect;
    else if (l.kind === "response") fx = "echo";
    else if (kind === "intro") {
      if (i === first.get(l.sectionId) && words <= SHORT_WORDS) fx = "title";
      else if (words <= 2 && /!$/.test(l.text.trim()) && canSlam) fx = "slam";
      else fx = flip(l.sectionId);
    } else if (kind === "verse" || kind === "other") {
      fx = isQuotation(l.text) || l.kind === "soft" ? "quote" : flip(l.sectionId);
    } else if (kind === "pre") {
      fx = preCurve.get(l.sectionId) === i && canCurve ? "curve" : "stack";
    } else if (kind === "chorus" || kind === "final") {
      if (titleLines.has(i) && !framed.has(l.sectionId) && l.start - lastFrame >= FRAME_GAP) fx = "frame";
      else if (canSlam) fx = "slam";
      else fx = words > SHORT_WORDS ? "pop" : "stack";
    } else if (kind === "bridge") {
      fx = i === first.get(l.sectionId) ? "quote" : flip(l.sectionId);
    } else if (kind === "outro") {
      if (canCurve) fx = "curve";
      else if (i === last.get(l.sectionId) && canSlam) fx = "slam";
      else fx = "stack";
    } else fx = flip(l.sectionId);

    // The engine only lets pop and stack carry a long line; a line's own choice is the user's call.
    if (!own && words > SHORT_WORDS && fx !== "pop" && fx !== "stack" && fx !== "echo") fx = "pop";

    // Lively has no frame in its pool: it becomes a slam if the slam guards allow, else a stack.
    // Done before the bookkeeping so the new slam counts for the 4 s gap.
    if (!own && energy === "lively" && fx === "frame") fx = canSlam ? "slam" : "stack";

    if (fx === "slam") lastSlamEnd = l.end;
    if (fx === "frame") { lastFrame = l.start; framed.add(l.sectionId); }
    if (fx === "curve") { lastCurve = l.start; curved.add(l.sectionId); }
    // Stepped down after the spacing above, so calm is the same plan with the big moves made quiet.
    let out = !own && energy === "calm" ? CALM_STEP[fx] ?? fx : fx;
    // A call shares the screen with its echoes (§6.2), so it stays out of their lower band. Only a
    // run of replies all drawn as echoes shares the screen; a reply the user pinned to another
    // effect comes after the call, so the call keeps its own move.
    if (!own && l.kind !== "response" && repliesEcho(lines, i) && LOWER_BAND.has(out)) out = "stack";
    return out;
  });
}
