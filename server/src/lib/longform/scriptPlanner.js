/**
 * Long-form script planner: outline (LLM) → per-section text (LLM reflection
 * + verbatim scripture from the Bible API). Scripture is NEVER LLM-generated —
 * it always comes from `lookupVerses`; a lookup failure surfaces as a named
 * error rather than a silent paraphrase.
 */
import { defaultLlmComplete } from "../story/scriptRefine.js";
import { lookupVerses } from "../bible/scriptureApi.js";
import { wordBudget } from "./templates.js";

let _llm = defaultLlmComplete;
export function _setLlmImpl(fn) { _llm = fn; }
export function _resetLlmImpl() { _llm = defaultLlmComplete; }

let _lookup = lookupVerses;
export function _setVerseLookupImpl(fn) { _lookup = fn; }
export function _resetVerseLookupImpl() { _lookup = lookupVerses; }

const MIN_SECTIONS = 3;
const MAX_SECTIONS = 40;

function stripFence(s) {
  return String(s || "").trim().replace(/^```[a-z]*\n?/i, "").replace(/```$/i, "").trim();
}

/**
 * Parse the outline JSON the LLM returned. Pure function, exported for tests.
 * @param {string} raw
 * @returns {{ title: string, summary: string, sections: Array<{ heading: string, reference: string|null, targetSec: number }> }}
 */
export function parseOutline(raw) {
  let obj;
  try { obj = JSON.parse(stripFence(raw)); } catch { throw new Error("outline: model did not return valid JSON"); }
  const sections = Array.isArray(obj?.sections) ? obj.sections : [];
  if (sections.length < MIN_SECTIONS) throw new Error(`outline: expected at least ${MIN_SECTIONS} sections`);
  return {
    title: String(obj.title || "").trim().slice(0, 100) || "Scripture Session",
    summary: String(obj.summary || "").trim(),
    sections: sections.slice(0, MAX_SECTIONS).map((s) => ({
      heading: String(s.heading || "").trim() || "Section",
      reference: s.reference ? String(s.reference).trim() : null,
      targetSec: Math.max(20, Math.round(Number(s.targetSec) || 60)),
    })),
  };
}

function outlinePrompt({ idea, template, targetSec }) {
  return [
    template.structurePrompt,
    `Total length: ${targetSec} seconds of narration at about ${template.wpm} words per minute.`,
    "Return ONLY JSON: {\"title\": string (≤100 chars, a YouTube title a real person would click), \"summary\": string (2 sentences for the video description), \"sections\": [{\"heading\": string, \"reference\": string|null (a Bible reference like \"Psalm 23:1-4\" for scripture sections, null for welcome/closing), \"targetSec\": number}]}.",
    "Section targetSec values must add up to the total length.",
    "",
    "Seed idea:",
    String(idea || "").trim(),
  ].join("\n");
}

function sectionPrompt({ template, section, verseText, words }) {
  return [
    template.structurePrompt,
    `Write ONLY the reflection for the section "${section.heading}" — about ${words} words.`,
    verseText
      ? `The listener has just heard this passage read verbatim (do not repeat or paraphrase it):\n${verseText}`
      : "There is no passage in this section.",
    "Return ONLY the spoken text — no headings, no markdown, no quotes, no stage directions.",
  ].join("\n");
}

async function fetchVerseText(reference, translation) {
  try {
    const r = await _lookup(reference, translation);
    const verses = Array.isArray(r?.verses) ? r.verses : [];
    const text = verses.map((v) => String(v.text || "").replace(/\s+/g, " ").trim()).filter(Boolean).join(" ");
    if (!text) throw new Error("no verse text returned");
    return text;
  } catch (e) {
    throw new Error(`scripture lookup failed for ${reference}: ${e?.message || e}`);
  }
}

async function writeSection({ template, section, translation }) {
  const verseText = section.reference ? await fetchVerseText(section.reference, translation) : "";
  // Verse reading time comes out of the section budget before the reflection is sized.
  const verseWords = verseText ? verseText.split(/\s+/).length : 0;
  const reflectionWords = Math.max(30, wordBudget(template, section.targetSec) - verseWords);
  const reflection = stripFence(await _llm(sectionPrompt({ template, section, verseText, words: reflectionWords })));
  const text = verseText ? `${section.reference}. ${verseText} ${reflection}`.trim() : reflection;
  return { ...section, verseText, text };
}

/**
 * Plan a long-form script: outline → per-section text. Scripture is fetched,
 * never generated. Sections are written sequentially (LLM rate limits).
 *
 * @param {{ idea: string, template: import("./templates.js").LongformTemplate, translation?: string, targetSec?: number }} args
 * @returns {Promise<{ title: string, summary: string, sections: Array<{ heading: string, reference: string|null, verseText: string, text: string, targetSec: number }> }>}
 */
export async function planLongformScript({ idea, template, translation = "kjv", targetSec }) {
  const total = Number(targetSec) > 0 ? Number(targetSec) : template.targetSec;
  const outline = parseOutline(await _llm(outlinePrompt({ idea, template, targetSec: total })));
  const sections = [];
  for (const section of outline.sections) {
    sections.push(await writeSection({ template, section, translation }));
  }
  return { title: outline.title, summary: outline.summary, sections };
}
