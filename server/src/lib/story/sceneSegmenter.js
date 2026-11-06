import { composeScenePrompt } from "./styleAnchors.js";

// Injected LLM completion: (prompt:string) => Promise<string>. Default does the
// gpt-4o-mini -> gemini-2.0-flash fallback. Mockable in tests via _setLlmImpl
// (mirrors the _setTranscribeAudioImpl seam in routes/transcribe.js).
let _llm = defaultLlmComplete;
export function _setLlmImpl(impl) { _llm = impl; }
export function _resetLlmImpl() { _llm = defaultLlmComplete; }

/**
 * One completion through the same helper the segmenter uses (and the same
 * _setLlmImpl stub in tests). The music video prompts call it.
 * @param {string} prompt
 * @returns {Promise<string>}
 */
export function completeLlm(prompt) { return _llm(prompt); }

const TARGET_SEC_DEFAULT = 8;
// Hard ceiling on scenes per project. Each scene is one AI image generated at
// render time, so the scene count IS the image-generation cost and wall-clock.
// A 27-min recording at the 8s default would demand ~200 sequential images
// (~45min, and exhausts the daily image-gen quota). Above this many, scenes
// are widened (fewer, longer scenes) so a long recording still finishes.
const MAX_SCENES = Math.max(8, Number(process.env.STORY_MAX_SCENES) || 60);

/**
 * @param {object} args
 * @param {Array<{text:string,startMs:number,endMs:number}>} args.words
 * @param {string} args.style
 * @param {number} [args.targetSec=8]
 * @param {number} [args.maxScenes] optional per-call override for the scene cap;
 *   a finite number >= 1 widens (or narrows) the env-derived MAX_SCENES ceiling.
 * @returns {Promise<Array<object>>} scene objects
 */
export async function segmentScenes({ words, style, targetSec = TARGET_SEC_DEFAULT, cast = [], maxScenes }) {
  if (!Array.isArray(words) || words.length === 0) return [];
  const cap = Number.isFinite(Number(maxScenes)) && Number(maxScenes) >= 1 ? Math.round(Number(maxScenes)) : MAX_SCENES;
  const baseTargetSec = Number.isFinite(Number(targetSec)) && Number(targetSec) > 0
    ? Number(targetSec) : TARGET_SEC_DEFAULT;
  // Match the renderer: the first image starts at zero; each subsequent image
  // starts at its first word, and the final image ends at the last word end.
  // Unreported trailing audio cannot be accounted for by this API.
  const boundaries = [0, ...words.slice(1).map((w) => w.startMs), words.at(-1).endMs];
  const totalSec = Math.max(0, boundaries.at(-1) / 1000);
  let effectiveTargetSec = Math.max(baseTargetSec, totalSec / cap);
  let maxDisplayMs = (1.5 * effectiveTargetSec + 0.5) * 1000;
  let plan = windowPlan(boundaries, maxDisplayMs);
  // Sparse word boundaries can make total/cap insufficient (e.g. five 16s
  // word/silence cells into four scenes). Widen only as far as necessary to
  // make the budget feasible, rather than dumping overflow into the last scene.
  // A single cell longer than the bound is always indivisible and may stand
  // alone, never serve as permission to append more words to a giant scene.
  if (plan.counts[0] > cap) {
    let low = maxDisplayMs;
    let high = Math.max(low, totalSec * 1000);
    for (let i = 0; i < 50; i++) {
      const mid = (low + high) / 2;
      if (windowPlan(boundaries, mid).counts[0] <= cap) high = mid;
      else low = mid;
    }
    maxDisplayMs = high;
    effectiveTargetSec = Math.max(effectiveTargetSec, (maxDisplayMs / 1000 - 0.5) / 1.5);
    plan = windowPlan(boundaries, maxDisplayMs);
  }

  let llmScenes = null;
  try {
    const raw = await _llm(buildSegmentPrompt(words, effectiveTargetSec));
    llmScenes = parseLlmScenes(raw);
  } catch {
    llmScenes = null;
  }

  // Validate the raw indices BEFORE coercion, sorting or clamping could hide
  // omissions, overlaps or malformed ranges. Coverage is a word partition,
  // not a sum of durations (overlaps used to mask missing words).
  const llmRanges = exactPartition(llmScenes, words.length, cap);
  const ranges = llmRanges && llmRanges.every((r) =>
    r.end + 1 <= plan.reach[r.start])
    ? llmRanges
    : fallbackRanges(boundaries, effectiveTargetSec, cap, plan);

  return ranges.map((r, i) => {
    const { start, end } = r;
    // LLM prose is only an image prompt; displayed/spoken text is authoritative
    // input text, with original token spelling, punctuation and casing intact.
    const text = words.slice(start, end + 1).map((w) => w.text).join(" ");
    const prompt = (r.imagePrompt || text).trim();
    return {
      id: `scene-${String(i + 1).padStart(3, "0")}`,
      text,
      startMs: words[start].startMs,
      endMs: words[end].endMs,
      // composeScenePrompt orders subject -> cast -> style. The project-level
      // cast is applied to EVERY scene: a recurring figure regenerated from
      // scratch each scene is the main reason AI-assembled stories look
      // incoherent. With no cast this is byte-identical to the previous
      // `${prompt}, ${anchor}` output.
      imagePrompt: composeScenePrompt(prompt, { style, characters: cast }),
      imagePath: null,
      imageStatus: "pending",
      promptEditedByUser: false,
    };
  });
}

function exactPartition(scenes, wordCount, cap) {
  if (!Array.isArray(scenes) || scenes.length === 0 || scenes.length > cap) return null;
  const ranges = [];
  let next = 0;
  for (const s of scenes) {
    if (!s || !Number.isInteger(s.startWordIndex) || !Number.isInteger(s.endWordIndex)
      || s.startWordIndex !== next || s.endWordIndex < s.startWordIndex
      || s.endWordIndex >= wordCount) return null;
    ranges.push({ start: s.startWordIndex, end: s.endWordIndex,
      imagePrompt: String(s.imagePrompt || "").trim() });
    next = s.endWordIndex + 1;
  }
  return next === wordCount ? ranges : null;
}

// reach[i] is the farthest exclusive boundary reachable from i within the
// display bound. An oversized single word/silence cell may only stand alone.
// Greedy farthest cuts give the minimum suffix scene count for each boundary.
// Assumes finite, chronological input word timings, as the previous segmenter did.
function windowPlan(boundaries, maxMs) {
  const n = boundaries.length - 1;
  const reach = new Array(n);
  let end = 1;
  for (let start = 0; start < n; start++) {
    end = Math.max(end, start + 1);
    while (end < n && boundaries[end + 1] - boundaries[start] <= maxMs) end++;
    reach[start] = end;
  }
  const counts = new Array(n + 1).fill(0);
  for (let start = n - 1; start >= 0; start--) counts[start] = 1 + counts[reach[start]];
  return { reach, counts };
}

// Prefer target-sized scenes, but reserve enough budget for a bounded suffix.
// The old greedy threshold could strand a tiny final word in cap+1 scenes.
function fallbackRanges(boundaries, targetSec, cap, { reach, counts }) {
  const ranges = [];
  const n = boundaries.length - 1;
  for (let start = 0; start < n;) {
    const remaining = cap - ranges.length - 1;
    let best = reach[start];
    let distance = Infinity;
    for (let end = start + 1; end <= reach[start]; end++) {
      if (counts[end] > remaining) continue;
      const d = Math.abs(boundaries[end] - boundaries[start] - targetSec * 1000);
      if (d < distance) { best = end; distance = d; }
    }
    ranges.push({ start, end: best - 1, imagePrompt: "" });
    start = best;
  }
  return ranges;
}

function buildSegmentPrompt(words, targetSec) {
  const indexed = words.map((w, i) => `${i}:${w.text}`).join(" ");
  const last = words.length - 1;
  const totalSec = Math.max(1, Math.round((words[last].endMs - words[0].startMs) / 1000));
  const approxScenes = Math.max(1, Math.round(totalSec / targetSec));
  return [
    "You are segmenting a spoken transcript into visual scenes for a video.",
    `The transcript is ${words.length} words (indices 0 to ${last}) and runs about ${totalSec} seconds.`,
    `Group the numbered words into consecutive scenes, each about ${targetSec} seconds of speech (roughly ${approxScenes} scenes in total),`,
    "split on meaning (one image per idea). Every word must belong to a scene: the first scene starts at index 0,",
    `the last scene ends at index ${last}, and scenes are contiguous with no gaps. Do not stop early.`,
    "For each scene return the inclusive startWordIndex and endWordIndex (referencing the numbers), the scene's",
    "caption text, and a vivid, concrete imagePrompt describing a single photographic image for that scene (no text in the image).",
    'Respond ONLY with JSON: {"scenes":[{"text","startWordIndex","endWordIndex","imagePrompt"}]}.',
    "",
    "Words:",
    indexed,
  ].join("\n");
}

function parseLlmScenes(raw) {
  if (!raw || typeof raw !== "string") return null;
  const parsed = tryParse(raw.trim()) ?? tryParse(extractBraceBlock(raw));
  if (!parsed || !Array.isArray(parsed.scenes) || parsed.scenes.length === 0) return null;
  return parsed.scenes;
}

function tryParse(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

// Fallback for responses wrapped in ```json fences or prose: grab the first
// balanced-looking object. Greedy to the last brace, which is fine once the
// direct parse above has already handled clean JSON.
function extractBraceBlock(raw) {
  const match = raw.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

// Default dual-provider completion. Mirrors generateScripts.js openai/gemini.
async function defaultLlmComplete(prompt) {
  return (await openaiComplete(prompt)) ?? (await geminiComplete(prompt)) ?? "";
}

async function openaiComplete(prompt) {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key.startsWith("your-")) return null;
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4,
        response_format: { type: "json_object" },
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

async function geminiComplete(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.startsWith("your-")) return null;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, responseMimeType: "application/json" },
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? null;
  } catch {
    return null;
  }
}
