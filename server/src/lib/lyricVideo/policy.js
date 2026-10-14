/**
 * Which effect each line gets, from its section and its shape (spec §6.1).
 * Effects are forced into the engine's plan, and forced choices skip the
 * engine's own checks, so this keeps its spacing rules itself: slams 4 s
 * apart and at most 4 words, a frame every 30 s, a curve every 20 s, and
 * only pop/stack past 5 words.
 */
const SLAM_GAP = 4;
const FRAME_GAP = 30;
const CURVE_GAP = 20;
const SLAM_MAX_WORDS = 4;
const SHORT_WORDS = 5;
/** On the calm energy the big moves step down to the quiet ones (a line's own choice is kept). */
const CALM_STEP = Object.freeze({ slam: "pop", frame: "stack", curve: "stack" });

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

/** One effect id per line. `energy` is the project's energy id; "calm" leaves out slams, frames and curves. */
export function chooseEffects({ lines, sections, title, energy }) {
  const kindOf = new Map(sections.map((s) => [s.id, s.kind]));
  const titleLines = titleLineIndexes(lines, title, sections);
  const { first, last } = sectionBounds(lines);
  const preCurve = preCurveLines(lines, kindOf, first, last);
  const alternation = new Map();
  const flip = (sid) => {
    const n = (alternation.get(sid) || 0) + 1;
    alternation.set(sid, n);
    return n % 2 === 1 ? "stack" : "pop";
  };
  const framed = new Set();
  const curved = new Set();
  let lastSlamEnd = -Infinity;
  let lastFrame = -Infinity;
  let lastCurve = -Infinity;

  return lines.map((l, i) => {
    const words = wordCount(l.text);
    const kind = kindOf.get(l.sectionId) || "other";
    const own = l.effect && l.effect !== "auto";
    const canSlam = words <= SLAM_MAX_WORDS && l.start - lastSlamEnd >= SLAM_GAP;
    const canCurve = words <= SHORT_WORDS && l.start - lastCurve >= CURVE_GAP && !curved.has(l.sectionId);
    let fx;
    if (own) fx = l.effect;
    else if (l.kind === "response") fx = "pop";
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
    if (!own && words > SHORT_WORDS && fx !== "pop" && fx !== "stack") fx = "pop";

    if (fx === "slam") lastSlamEnd = l.end;
    if (fx === "frame") { lastFrame = l.start; framed.add(l.sectionId); }
    if (fx === "curve") { lastCurve = l.start; curved.add(l.sectionId); }
    // Stepped down after the spacing above, so calm is the same plan with the big moves made quiet.
    return !own && energy === "calm" ? CALM_STEP[fx] ?? fx : fx;
  });
}
