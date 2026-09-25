import { anchorFor, composeScenePrompt } from "./styleAnchors.js";

// Injected LLM completion: (prompt:string) => Promise<string>. Default does the
// gpt-4o-mini -> gemini-2.0-flash fallback. Mockable in tests via _setLlmImpl
// (mirrors the _setTranscribeAudioImpl seam in routes/transcribe.js).
let _llm = defaultLlmComplete;
export function _setLlmImpl(impl) { _llm = impl; }
export function _resetLlmImpl() { _llm = defaultLlmComplete; }

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
 * @returns {Promise<Array<object>>} scene objects
 */
export async function segmentScenes({ words, style, targetSec = TARGET_SEC_DEFAULT, cast = [] }) {
  if (!Array.isArray(words) || words.length === 0) return [];
  const baseTargetSec = Number(targetSec) > 0 ? Number(targetSec) : TARGET_SEC_DEFAULT;
  // Widen scenes for long audio so the count never exceeds MAX_SCENES. The
  // effective target is whichever is LONGER: the requested per-scene length, or
  // the length needed to fit the whole recording into MAX_SCENES scenes.
  const totalSec = Math.max(0, (words[words.length - 1].endMs - words[0].startMs) / 1000);
  const minSecForCap = totalSec > 0 ? totalSec / MAX_SCENES : baseTargetSec;
  const effectiveTargetSec = Math.max(baseTargetSec, minSecForCap);
  const anchor = anchorFor(style);

  let llmScenes = null;
  try {
    const raw = await _llm(buildSegmentPrompt(words, effectiveTargetSec));
    llmScenes = parseLlmScenes(raw);
  } catch {
    llmScenes = null;
  }

  // Use the LLM split only when it's present AND respects the cap. If it
  // over-segments (ignoring the widened target), fall back to bounded
  // duration windows so we never blow past MAX_SCENES.
  const ranges =
    llmScenes && llmScenes.length > 0 && llmScenes.length <= MAX_SCENES
      ? llmScenes.map((s) => ({
          text: String(s.text || "").trim(),
          start: clampIndex(s.startWordIndex, words.length),
          end: clampIndex(s.endWordIndex, words.length),
          imagePrompt: String(s.imagePrompt || "").trim(),
        }))
      : fallbackRanges(words, effectiveTargetSec);

  return ranges.map((r, i) => {
    const start = Math.min(r.start, r.end);
    const end = Math.max(r.start, r.end);
    const text = r.text || words.slice(start, end + 1).map((w) => w.text).join(" ");
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

function clampIndex(idx, len) {
  const n = Number(idx);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(len - 1, Math.floor(n)));
}

// Split words into contiguous windows whose spoken duration is ~targetSec.
function fallbackRanges(words, targetSec) {
  const ranges = [];
  let startIdx = 0;
  const windowMs = targetSec * 1000;
  for (let i = 0; i < words.length; i++) {
    const spanMs = words[i].endMs - words[startIdx].startMs;
    const isLast = i === words.length - 1;
    if (spanMs >= windowMs || isLast) {
      ranges.push({ start: startIdx, end: i, text: "", imagePrompt: "" });
      // Advance past the word just consumed; if that was the last word the
      // outer loop ends, so startIdx never indexes past the array.
      startIdx = i + 1;
    }
  }
  return ranges;
}

function buildSegmentPrompt(words, targetSec) {
  const indexed = words.map((w, i) => `${i}:${w.text}`).join(" ");
  return [
    "You are segmenting a sermon transcript into visual scenes for a short video.",
    `Group the numbered words below into consecutive scenes, each about ${targetSec} seconds of speech,`,
    "split on meaning (one image per idea). For each scene return the inclusive startWordIndex and",
    "endWordIndex (referencing the numbers), the scene's caption text, and a vivid, concrete imagePrompt",
    "describing a single photographic image for that scene (no text in the image).",
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
