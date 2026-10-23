import { defaultLlmComplete } from "../story/scriptRefine.js";
import { filmableVisual } from "./shots.js";

/**
 * Suggested shot prompts: one LLM call turns each shot's visual, the words
 * spoken over it and the lead character into a vivid, filmable prompt (the
 * prototype's hand-written prompts are the model). Suggestions never touch
 * spoken words and are marked "suggested" until the operator accepts or
 * edits them.
 */

const MAX_PROMPT_CHARS = 600;

function shotBrief(project, shot) {
  const scene = project.scenes.find((s) => s.id === shot.sceneId);
  const lines = project.lines.filter((l) => l.sceneId === shot.sceneId);
  const from = lines.findIndex((l) => l.id === shot.startLineId);
  const next = project.shots.find((s, i) => i > project.shots.indexOf(shot) && s.sceneId === shot.sceneId);
  const to = next ? lines.findIndex((l) => l.id === next.startLineId) : lines.length;
  return {
    id: shot.id,
    scene: scene?.title || "",
    visual: shot.montage ? shot.text : filmableVisual(scene?.visual || shot.text),
    montageSubject: Boolean(shot.montage),
    framing: shot.framing || "",
    spoken: lines.slice(Math.max(0, from), to).map((l) => l.text).join(" "),
  };
}

export function directorPrompt(project, shots) {
  const lead = project.look?.lead || "";
  return [
    "You are the director of photography for a short faith film made with an AI video model.",
    "Write one prompt per shot. Each prompt is one or two sentences describing exactly what the camera sees and how it moves.",
    "Rules:",
    "- Keep the author's visual intent. Never add dialogue, words on screen, captions, signs or logos.",
    "- Describe every person explicitly: age, skin tone, hair, clothing. Unless the visual says otherwise, people are Black African, in an African or Nigerian setting.",
    lead ? `- When a shot shows the main character, describe them exactly as: "${lead}".` : "- There is no fixed main character.",
    "- A montage subject is a different person from the main character.",
    "- Avoid famous or iconic poses (for example a silhouette on a hilltop with arms raised); they are refused for copyright. Prefer ordinary, intimate moments.",
    "- Do not mention music or sound.",
    "- Vary framing between shots of the same scene: wide, close-up, low angle, tracking.",
    `- Title: ${project.meta?.title || ""}.`,
    "Return only JSON: an array of {\"id\": \"<shot id>\", \"prompt\": \"<prompt>\"}.",
    "Shots:",
    JSON.stringify(shots),
  ].join("\n");
}

export function parseSuggestions(text, ids) {
  const match = /\[[\s\S]*\]/.exec(String(text || ""));
  if (!match) return {};
  let arr;
  try { arr = JSON.parse(match[0]); } catch { return {}; }
  const wanted = new Set(ids);
  const out = {};
  for (const item of Array.isArray(arr) ? arr : []) {
    const prompt = String(item?.prompt || "").replace(/\s+/g, " ").trim().slice(0, MAX_PROMPT_CHARS);
    if (wanted.has(item?.id) && prompt) out[item.id] = prompt;
  }
  return out;
}

/**
 * @returns {Promise<{ ok: boolean, prompts?: Record<string, string>, error?: string }>}
 */
export async function suggestShotPrompts(project, { shotIds, llm = defaultLlmComplete } = {}) {
  const wanted = Array.isArray(shotIds) && shotIds.length ? new Set(shotIds) : null;
  const shots = project.shots.filter((s) => !wanted || wanted.has(s.id));
  if (!shots.length) return { ok: false, error: "No shots to suggest." };
  const text = await llm(directorPrompt(project, shots.map((s) => shotBrief(project, s))));
  const prompts = parseSuggestions(text, shots.map((s) => s.id));
  if (!Object.keys(prompts).length) return { ok: false, error: "No suggestions came back. Try again." };
  const style = project.look?.style ? ` ${project.look.style}` : "";
  return { ok: true, prompts: Object.fromEntries(Object.entries(prompts).map(([id, p]) => [id, `${p}${style}`])) };
}
