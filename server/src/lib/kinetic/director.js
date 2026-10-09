/**
 * Picks how each phrase is drawn. Deterministic: the same phrases, energy
 * and seed always give the same plan, so a re-render matches the approved
 * video and Shuffle (a new seed) gives a new one.
 */
export const EFFECT_IDS = Object.freeze(["pop", "stack", "slam", "quote", "curve", "frame", "title"]);

const MIX = Object.freeze({
  calm: { normal: ["pop", "stack"], hook: ["stack", "pop"] },
  lively: { normal: ["stack", "pop", "quote", "stack", "curve"], hook: ["slam", "stack"] },
  wild: { normal: ["slam", "stack", "slam", "quote", "slam", "curve", "pop"], hook: ["frame", "slam"] },
});

const SLAM_GAP_SEC = 4;
const SLAM_MAX_WORDS = 4;
const LONG_PHRASE_WORDS = 5;
const FRAME_GAP_SEC = 30;
const CURVE_GAP_SEC = 20;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function normaliseLine(text) {
  return String(text || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

export function findHooks(phrases) {
  const counts = new Map();
  phrases.forEach((p) => {
    const k = normaliseLine(p.text);
    if (k) counts.set(k, (counts.get(k) || 0) + 1);
  });
  const hooks = new Set();
  phrases.forEach((p, i) => { if ((counts.get(normaliseLine(p.text)) || 0) >= 2) hooks.add(i); });
  return hooks;
}

function allowed(effect, s) {
  if (effect === s.prev && effect !== "pop") return false;
  if (s.words > LONG_PHRASE_WORDS && effect !== "pop" && effect !== "stack") return false;
  if (effect === "slam" && (s.words > SLAM_MAX_WORDS || s.start - s.lastSlamEnd < SLAM_GAP_SEC)) return false;
  if (effect === "frame" && (!s.hook || s.start - s.lastFrameStart < FRAME_GAP_SEC)) return false;
  if (effect === "curve" && s.start - s.lastCurveStart < CURVE_GAP_SEC) return false;
  return true;
}

function fallbackEffect(energy, prev) {
  if (energy === "calm") return "pop";
  return prev === "stack" ? "pop" : "stack";
}

export function planPhrases({ phrases, energy = "lively", seed = 1, overrides = null, slotCount = 5, titleFirst = true }) {
  const s = Number(seed);
  const rnd = mulberry32(Number.isFinite(s) ? Math.floor(s) : 1);
  const forced = overrides ?? {};
  const mix = MIX[energy] || MIX.lively;
  const hooks = findHooks(phrases);
  const slots = Math.max(1, Math.floor(Number(slotCount)) || 1);
  let prev = null;
  let lastSlamEnd = -Infinity;
  let lastFrameStart = -Infinity;
  let lastCurveStart = -Infinity;
  let slot = -1;
  return phrases.map((phrase, index) => {
    // Always draw the same three values per phrase, so an override on one
    // phrase cannot shift the slot or rotation of any other phrase.
    const rEffect = rnd();
    const rSlot = rnd();
    const rRot = rnd();
    const words = String(phrase.text).trim().split(/\s+/).filter(Boolean).length;
    const hook = hooks.has(index);
    let effect;
    if (EFFECT_IDS.includes(forced[index])) {
      effect = forced[index];
    } else if (energy === "wild" && index === 0 && titleFirst && words <= LONG_PHRASE_WORDS) {
      effect = "title"; // a wild video opens on its first line as a title
    } else {
      const state = { prev, words, start: phrase.start, lastSlamEnd, lastFrameStart, lastCurveStart, hook };
      const pool = (hook ? mix.hook : mix.normal).filter((e) => allowed(e, state));
      effect = pool.length ? pool[Math.floor(rEffect * pool.length)] : fallbackEffect(energy, prev);
    }
    if (effect === "slam") lastSlamEnd = phrase.end;
    if (effect === "frame") lastFrameStart = phrase.start;
    if (effect === "curve") lastCurveStart = phrase.start;
    slot = slots === 1 ? 0 : (slot + 1 + Math.floor(rSlot * (slots - 1))) % slots;
    const rot = (index % 2 === 0 ? -1 : 1) * (1 + Math.floor(rRot * 4));
    prev = effect;
    return { index, phrase, effect, slot, hook, rot };
  });
}
