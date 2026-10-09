/**
 * Picks how each phrase is drawn. Deterministic: the same phrases, energy
 * and seed always give the same plan, so a re-render matches the approved
 * video and Shuffle (a new seed) gives a new one.
 */
export const EFFECT_IDS = Object.freeze(["pop", "stack", "slam"]);

const MIX = Object.freeze({
  calm: { normal: ["pop", "stack"], hook: ["stack", "pop"] },
  lively: { normal: ["stack", "pop", "stack"], hook: ["slam", "stack"] },
  wild: { normal: ["slam", "stack", "slam", "pop"], hook: ["slam"] },
});

const SLAM_GAP_SEC = 4;
const SLAM_MAX_WORDS = 4;
const LONG_PHRASE_WORDS = 5;

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

function allowed(effect, { prev, words, start, lastSlamEnd }) {
  if (effect === prev && effect !== "pop") return false;
  if (words > LONG_PHRASE_WORDS && effect !== "pop" && effect !== "stack") return false;
  if (effect === "slam" && (words > SLAM_MAX_WORDS || start - lastSlamEnd < SLAM_GAP_SEC)) return false;
  return true;
}

function fallbackEffect(energy, prev) {
  if (energy === "calm") return "pop";
  return prev === "stack" ? "pop" : "stack";
}

export function planPhrases({ phrases, energy = "lively", seed = 1, overrides = null, slotCount = 5 }) {
  const s = Number(seed);
  const rnd = mulberry32(Number.isFinite(s) ? Math.floor(s) : 1);
  const forced = overrides ?? {};
  const mix = MIX[energy] || MIX.lively;
  const hooks = findHooks(phrases);
  const slots = Math.max(1, Math.floor(Number(slotCount)) || 1);
  let prev = null;
  let lastSlamEnd = -Infinity;
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
    } else {
      const pool = (hook ? mix.hook : mix.normal).filter((e) => allowed(e, { prev, words, start: phrase.start, lastSlamEnd }));
      effect = pool.length ? pool[Math.floor(rEffect * pool.length)] : fallbackEffect(energy, prev);
    }
    if (effect === "slam") lastSlamEnd = phrase.end;
    slot = slots === 1 ? 0 : (slot + 1 + Math.floor(rSlot * (slots - 1))) % slots;
    const rot = (index % 2 === 0 ? -1 : 1) * (1 + Math.floor(rRot * 4));
    prev = effect;
    return { index, phrase, effect, slot, hook, rot };
  });
}
