/**
 * Long-form script planner: outline (LLM) → per-section text (LLM reflection
 * + verbatim scripture from the Bible API). Sections are written in parallel and
 * cannot read each other, so the outline assigns each one a distinct angle and
 * every section prompt carries its siblings' angles plus a worn-phrase ban —
 * without that, a 30 min session says the same thing six times in new words.
 * Scripture is NEVER LLM-generated —
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
// Sections are written with bounded concurrency so a 40-section outline
// finishes well inside Cloudflare's 100 s request ceiling, without hammering
// the LLM rate limit the way an unbounded Promise.all would.
const SECTION_CONCURRENCY = 4;
// Measured on a real 12 min session: "you are held in a" opened five of its
// fourteen sections and "that you are not alone" another five. Sections are
// written in parallel and cannot see each other's prose, so the sameness has
// to be headed off in the prompt — by naming the fillers every section reaches
// for, and by giving each one an angle no other section may take.
const WORN_PHRASES = [
  "you are held",
  "you are not alone",
  "in this moment",
  "in the knowledge that",
  "let go of",
  "the weight of the day",
  "as you settle in",
];

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
    // A null / non-object item (the model occasionally emits `null` for a
    // section it could not think of) becomes a default section rather than
    // a TypeError escaping the named-error path.
    sections: sections.slice(0, MAX_SECTIONS).map((raw) => {
      const s = raw && typeof raw === "object" ? raw : {};
      return {
        heading: String(s.heading || "").trim() || "Section",
        reference: s.reference ? String(s.reference).trim() : null,
        targetSec: Math.max(20, Math.round(Number(s.targetSec) || 60)),
        // The one thing only this section says. Absent from an older model
        // response, in which case the section prompt simply has less to go on.
        angle: String(s.angle || "").trim(),
      };
    }),
  };
}

function outlinePrompt({ idea, template, targetSec }) {
  return [
    template.structurePrompt,
    `Total length: ${targetSec} seconds of narration at about ${template.wpm} words per minute.`,
    "Return ONLY JSON: {\"title\": string (≤100 chars, a YouTube title a real person would click), \"summary\": string (2 sentences for the video description), \"sections\": [{\"heading\": string, \"reference\": string|null (a Bible reference like \"Psalm 23:1-4\" for scripture sections, null for welcome/closing), \"targetSec\": number, \"angle\": string}]}.",
    "Section targetSec values must add up to the total length.",
    "",
    "The angle is the one thing only that section says: a concrete image a listener could picture (a lamp left burning, a boat tied up for the night) and the single move it makes. Each section is written by someone who cannot read the others, so NO TWO SECTIONS may share an angle, an image or a theme — a listener hearing the whole session must never feel a section has come round again.",
    "",
    "Seed idea:",
    String(idea || "").trim(),
  ].join("\n");
}

function sectionPrompt({ template, section, siblings = [], verseText, words }) {
  const others = siblings
    .filter((s) => s !== section)
    .map((s) => `- ${s.heading}${s.angle ? `: ${s.angle}` : ""}`)
    .join("\n");
  return [
    template.structurePrompt,
    `Write ONLY the reflection for the section "${section.heading}" — about ${words} words.`,
    section.angle ? `This section's angle, and the only ground it covers: ${section.angle}` : "",
    others ? `The rest of the session covers the ground below. Those sections are already written; do not restate their ideas, reuse their images, or reach for the same comfort a second time:\n${others}` : "",
    `Do not use these worn phrases — every other section reaches for them and the session ends up sounding like one paragraph repeated: ${WORN_PHRASES.map((p) => `"${p}"`).join(", ")}. Do not open with "As you" or "In this".`,
    verseText
      ? `The listener has just heard this passage read verbatim (do not repeat or paraphrase it):\n${verseText}`
      : "There is no passage in this section.",
    "Return ONLY the spoken text — no headings, no markdown, no quotes, no stage directions.",
  ].filter(Boolean).join("\n");
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

async function writeSection({ template, section, siblings, translation }) {
  const verseText = section.reference ? await fetchVerseText(section.reference, translation) : "";
  // Verse reading time comes out of the section budget before the reflection is sized.
  const verseWords = verseText ? verseText.split(/\s+/).length : 0;
  const reflectionWords = Math.max(30, wordBudget(template, section.targetSec) - verseWords);
  const reflection = stripFence(await _llm(sectionPrompt({ template, section, siblings, verseText, words: reflectionWords })));
  const text = verseText ? `${section.reference}. ${verseText} ${reflection}`.trim() : reflection;
  return { ...section, verseText, text };
}

/**
 * Map `items` through an async `fn` with at most `limit` calls in flight.
 * Results come back in input order regardless of completion order; the
 * first rejection wins (remaining in-flight calls are left to settle).
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
async function mapWithConcurrency(items, limit, fn) {
  const width = Math.max(1, Math.min(Math.floor(Number(limit) || 1), items.length || 1));
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: width }, worker));
  return results;
}

/**
 * Plan a long-form script: outline → per-section text. Scripture is fetched,
 * never generated. Sections are written with bounded concurrency (see
 * SECTION_CONCURRENCY) and returned in outline order.
 *
 * @param {{ idea: string, template: import("./templates.js").LongformTemplate, translation?: string, targetSec?: number }} args
 * @returns {Promise<{ title: string, summary: string, sections: Array<{ heading: string, reference: string|null, verseText: string, text: string, targetSec: number }> }>}
 */
export async function planLongformScript({ idea, template, translation = "kjv", targetSec }) {
  const total = Number(targetSec) > 0 ? Number(targetSec) : template.targetSec;
  const outline = parseOutline(await _llm(outlinePrompt({ idea, template, targetSec: total })));
  const sections = await mapWithConcurrency(outline.sections, SECTION_CONCURRENCY, (section) => writeSection({ template, section, siblings: outline.sections, translation }));
  return { title: outline.title, summary: outline.summary, sections };
}
