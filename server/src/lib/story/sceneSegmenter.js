import { anchorFor } from "./styleAnchors.js";

// Injected LLM completion: (prompt:string) => Promise<string>. Default does the
// gpt-4o-mini -> gemini-2.0-flash fallback. Mockable in tests via _setLlmImpl
// (mirrors the _setTranscribeAudioImpl seam in routes/transcribe.js).
let _llm = defaultLlmComplete;
export function _setLlmImpl(impl) { _llm = impl; }
export function _resetLlmImpl() { _llm = defaultLlmComplete; }

const TARGET_SEC_DEFAULT = 8;

/**
 * @param {object} args
 * @param {Array<{text:string,startMs:number,endMs:number}>} args.words
 * @param {string} args.style
 * @param {number} [args.targetSec=8]
 * @returns {Promise<Array<object>>} scene objects
 */
export async function segmentScenes({ words, style, targetSec = TARGET_SEC_DEFAULT }) {
  if (!Array.isArray(words) || words.length === 0) return [];
  const anchor = anchorFor(style);

  let llmScenes = null;
  try {
    const raw = await _llm(buildSegmentPrompt(words, targetSec));
    llmScenes = parseLlmScenes(raw);
  } catch {
    llmScenes = null;
  }

  const ranges =
    llmScenes && llmScenes.length > 0
      ? llmScenes.map((s) => ({
          text: String(s.text || "").trim(),
          start: clampIndex(s.startWordIndex, words.length),
          end: clampIndex(s.endWordIndex, words.length),
          imagePrompt: String(s.imagePrompt || "").trim(),
        }))
      : fallbackRanges(words, targetSec);

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
      imagePrompt: `${prompt}, ${anchor}`,
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
  // Tolerate ```json fences / leading prose by extracting the first {...} block.
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!parsed || !Array.isArray(parsed.scenes) || parsed.scenes.length === 0) return null;
  return parsed.scenes;
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
