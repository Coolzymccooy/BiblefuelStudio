/**
 * Long-form formats. Pure data: the planner reads structurePrompt + wpm, the
 * narrator reads voice, the Story pipeline reads scene + music.
 *
 * Sleep sessions are deliberately slow and sparse: ~110 wpm, long pauses,
 * a dozen scenes with long crossfades, no captions. Watch-hours content.
 */
const SLEEP_STRUCTURE = [
  "You are writing a calm, slow scripture session for someone falling asleep.",
  "Structure: a gentle welcome (about 1 minute) → repeated cycles of one scripture passage read slowly, then a short reflection of 2–4 sentences, then rest → a closing blessing.",
  "Reflections are quiet reassurance, second person, present tense, no exclamation marks, no questions, no calls to action.",
  "Never paraphrase or invent scripture; the verse text is supplied verbatim and must be used as given.",
].join(" ");

const sleep = (id, minutes) => Object.freeze({
  id,
  label: `Scripture Sleep Session · ${minutes} min`,
  kind: "sleep",
  targetSec: minutes * 60,
  wpm: 110,
  structurePrompt: SLEEP_STRUCTURE,
  scene: { targetSceneSec: Math.round((minutes * 60) / 12), maxScenes: 12, captions: "none" },
  // Azure first: a 30-60 min session is ~20 chunks, and Chatterbox on a CPU box
  // takes minutes per chunk (hours per video) where Azure takes seconds. Edge is
  // the free fallback; Chatterbox only when neither of those is configured.
  voice: { preferredProviders: ["azure", "edge", "chatterbox"], rate: "-15%", pauseMs: 5000, maxChunkChars: 1200 },
  music: { volume: 0.22, autoDuck: false },
  thumbnailPrompt: "soft moonlit night sky over still water, warm candle glow, peaceful, cinematic, no text",
});

export const LONGFORM_TEMPLATES = Object.freeze([sleep("sleep-30", 30), sleep("sleep-60", 60)]);

export function longformTemplateById(id) {
  return LONGFORM_TEMPLATES.find((t) => t.id === String(id || "")) || null;
}

export function wordBudget(template, targetSec = template.targetSec) {
  return Math.round((Number(targetSec) / 60) * Number(template.wpm));
}
