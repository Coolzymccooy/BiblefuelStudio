// server/src/lib/musicVideo/scenePrompts.js
//
// AI music videos: one picture prompt per scene, written by one LLM call that
// reads the whole song, so the pictures follow its story. Any failure (an
// error, nonsense, the wrong count) falls back to a plain prompt built from the
// scene itself: a build never fails on prompts.
import { completeLlm } from "../story/sceneSegmenter.js";

const PROMPT_MAX = 600;
const SHOT = "cinematic music video shot";

const clean = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const firstLine = (scene) => clean(String(scene?.text ?? "").split(" / ")[0], 200);

/**
 * The prompt a scene gets when the LLM gives nothing usable:
 * "<character>, cinematic music video shot, <section label>: <first lyric line>".
 * @param {{label?:string,text?:string}} scene
 * @param {string} [character]
 */
export function fallbackPrompt(scene, character = "") {
  const label = clean(scene?.label, 80);
  const line = firstLine(scene);
  const where = label && line ? `${label}: ${line}` : label || line;
  return [clean(character, 300), SHOT, where].filter(Boolean).join(", ");
}

function buildRequest({ title, artist, scenes, character }) {
  const who = character
    ? `The singer is ${character}. Repeat this exact description, word for word, in every prompt where the singer or the main character appears, so the same person is seen in every scene.`
    : "When a person appears, call them the singer, and keep them the same person throughout.";
  const list = scenes.map((s, i) => {
    const sec = `${(s.startMs / 1000).toFixed(1)}-${(s.endMs / 1000).toFixed(1)} s`;
    const words = s.text ? `"${clean(s.text, 600)}"` : "(no singing: instrumental)";
    return `${i + 1}. [${clean(s.label, 80) || s.kind}] (${s.kind}, ${sec}) ${words}`;
  });
  return [
    `You are directing a music video for the song "${clean(title, 120)}"${artist ? ` by ${clean(artist, 120)}` : ""}.`,
    `Write exactly ${scenes.length} image prompts, one for each scene below, in the same order.`,
    "Each prompt describes ONE cinematic music-video shot as a single still photograph: who or what is in frame, the setting, the light and the camera framing.",
    "The prompts follow the song's story from scene to scene, drawing on what each scene's lyrics say.",
    who,
    "Every chorus scene returns to the same recurring visual motif, so the chorus is recognisable each time it comes back.",
    "Instrumental scenes show mood and place rather than a sung moment.",
    "No text, captions, lyrics, letters, signs or logos in any image.",
    `Respond ONLY with JSON: {"prompts":["...", "..."]} with exactly ${scenes.length} strings.`,
    "",
    "Scenes:",
    ...list,
  ].join("\n");
}

function tryParse(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

/** The prompt list from an LLM answer: {"prompts":[...]}, a bare array, or either inside fences or prose. */
function parsePrompts(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const parsed = tryParse(raw.trim()) ?? tryParse(raw.match(/\{[\s\S]*\}/)?.[0]) ?? tryParse(raw.match(/\[[\s\S]*\]/)?.[0]);
  const list = Array.isArray(parsed) ? parsed : parsed?.prompts ?? parsed?.scenes;
  if (!Array.isArray(list)) return null;
  return list.map((item) => clean(typeof item === "string" ? item : item?.imagePrompt, PROMPT_MAX));
}

/**
 * @param {object} args
 * @param {string} args.title
 * @param {string} [args.artist]
 * @param {Array<{startMs:number,endMs:number,kind:string,label:string,text:string}>} args.scenes from planMusicScenes
 * @param {string} [args.character] how the singer looks; empty for "the singer"
 * @param {(prompt:string) => Promise<string>} [args.llm] defaults to the segmenter's helper
 * @returns {Promise<string[]>} one prompt per scene, in order (no style anchor: Story adds it)
 */
export async function writeMusicPrompts({ title, artist = "", scenes, character = "", llm = completeLlm }) {
  const list = Array.isArray(scenes) ? scenes : [];
  if (!list.length) return [];
  const who = clean(character, 300);
  const fallback = list.map((s) => fallbackPrompt(s, who));
  let prompts = null;
  try {
    prompts = parsePrompts(await llm(buildRequest({ title, artist, scenes: list, character: who })));
  } catch (err) {
    console.warn(`[music-video] the scene prompts could not be written, using plain ones: ${err?.message || err}`);
  }
  if (!prompts || prompts.length !== list.length) return fallback;
  return prompts.map((p, i) => p || fallback[i]);
}
