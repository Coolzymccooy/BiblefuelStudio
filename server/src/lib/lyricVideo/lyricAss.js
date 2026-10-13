import { EFFECTS, assHeader } from "../kinetic/ass.js";
import { planPhrases } from "../kinetic/director.js";
import { resolveLook, resolveEnergy } from "../kinetic/looks.js";
import { aspectOf, slotsFor } from "../kinetic/layout.js";
import { chooseEffects } from "./policy.js";

const isPlaced = (l) => l && Array.isArray(l.words) && l.words.length > 0 && Number.isFinite(l.start) && Number.isFinite(l.end);

/** The project's captions as an ASS document, exactly as the render draws them. "" when no line is placed. */
export function buildLyricAss(project, { w, h, layout = "shorts" }) {
  const placed = (project.lines || []).filter(isPlaced);
  if (!placed.length) return "";
  const base = aspectOf(w, h);
  const aspect = layout === "shorts" && base === "tall" ? "shorts" : base;
  const look = resolveLook(project.look?.id || "studio-lagos-night");
  const energy = resolveEnergy(project.look?.energy, "wild");
  const effects = chooseEffects({ lines: placed, sections: project.sections || [], title: project.title || "", energy });
  const phrases = placed.map((l) => ({ text: l.text, start: l.start, end: l.end, words: l.words }));
  const overrides = Object.fromEntries(effects.map((fx, i) => [i, fx]));
  const plan = planPhrases({
    phrases, energy, seed: Number(project.look?.seed) || 1, overrides, slotCount: slotsFor(aspect).length, titleFirst: false,
  });
  const events = plan.flatMap((planned, i) => EFFECTS[planned.effect]({
    planned, look, energy, w, h, aspect,
    nextStart: i + 1 < plan.length ? plan[i + 1].phrase.start : Infinity,
  }));
  return `${assHeader(w, h)}\n${events.join("\n")}\n`;
}
