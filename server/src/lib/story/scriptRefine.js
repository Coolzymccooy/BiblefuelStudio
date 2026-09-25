// Injected LLM completion (prompt:string)=>Promise<string>. Default does the
// gpt-4o-mini -> gemini-2.0-flash fallback, same shape as sceneSegmenter.js.
let _llm = defaultLlmComplete;
export function _setLlmImpl(impl) { _llm = impl; }
export function _resetLlmImpl() { _llm = defaultLlmComplete; }

const WORDS_PER_SEC = 2.5;

/**
 * Refine a rough idea into a clean narration script (~template.targetSeconds).
 * @param {{ idea:string, template:{prompt:string,targetSeconds:number} }} args
 * @returns {Promise<string>} narration text (falls back to the idea on failure)
 */
export async function refineScript({ idea, template }) {
  const raw = String(idea || "").trim();
  if (!raw) return "";
  const targetWords = Math.max(20, Math.round((template?.targetSeconds || 40) * WORDS_PER_SEC));
  const prompt = [
    "You are scripting a short spoken voiceover for a Christian social video.",
    template?.prompt ? template.prompt : "Clean up the idea into a clear, natural spoken narration.",
    `Aim for about ${targetWords} words (roughly ${template?.targetSeconds || 40} seconds of speech).`,
    "Return ONLY the narration text to be spoken — no markdown, no quotes, no headings, no stage directions.",
    "",
    "Idea:",
    raw,
  ].join("\n");

  let text = "";
  try {
    text = clean(await _llm(prompt));
  } catch {
    text = "";
  }
  return text || raw;
}

function clean(s) {
  let t = String(s || "").trim();
  t = t.replace(/^```[a-z]*\n?/i, "").replace(/```$/i, "").trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1).trim();
  }
  return t;
}

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
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], temperature: 0.7 }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.choices?.[0]?.message?.content ?? null;
  } catch { return null; }
}
async function geminiComplete(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.startsWith("your-")) return null;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.7 } }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? null;
  } catch { return null; }
}
