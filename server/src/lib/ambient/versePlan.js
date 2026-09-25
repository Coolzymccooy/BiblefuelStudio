import { normalizeReference } from "../bible/bibleReference.js";
import { defaultLlmComplete } from "../story/scriptRefine.js";

/**
 * Verse planning — decide WHICH references a session speaks, never what they say.
 *
 * The spec's hard line: "the model may suggest which references; the words come
 * verbatim from lookupVerses". So this module returns citations only. Every
 * suggestion is run through `normalizeReference`, which checks the book exists
 * and the chapter/verse are in range, so a hallucinated "Psalms 200:4" is
 * discarded here rather than failing at lookup time with an empty drop.
 *
 * When no LLM key is configured — or the model returns nothing usable — the
 * curated list below carries the feature. A theme-agnostic set of rest,
 * stillness and comfort passages is a perfectly good ambient session, and the
 * operator edits references in the UI anyway.
 */

/** Injected for tests; defaults to the same OpenAI→Gemini fallback Story uses. */
let _llm = defaultLlmComplete;
export function _setLlmImpl(impl) { _llm = impl; }
export function _resetLlmImpl() { _llm = defaultLlmComplete; }

/**
 * Rest, stillness and comfort — the format's native register. Used whole when
 * no model is available, and as a top-up when the model returns too few.
 */
export const FALLBACK_REFERENCES = Object.freeze([
  "Psalms 23:1-3",
  "Psalms 4:8",
  "Matthew 11:28-30",
  "Isaiah 26:3",
  "Psalms 46:10",
  "John 14:27",
  "Isaiah 40:31",
  "Psalms 91:1-2",
  "Philippians 4:6-7",
  "Psalms 121:1-4",
  "Zephaniah 3:17",
  "Psalms 3:5",
  "Proverbs 3:24",
  "Psalms 62:1-2",
  "Lamentations 3:22-23",
  "Psalms 27:1",
  "Romans 8:38-39",
  "Psalms 143:8",
  "2 Corinthians 12:9",
  "Psalms 34:18",
]);

/**
 * Ask the model for `count` references on `theme`.
 *
 * Returns canonical strings only — anything unparseable or out of range is
 * dropped, so a caller never has to defend against a fabricated citation.
 *
 * @param {{ theme?: string, count: number }} args
 * @returns {Promise<string[]>}
 */
export async function suggestReferences({ theme, count }) {
  const wanted = Math.max(1, Math.round(Number(count) || 0));
  const subject = String(theme || "").trim();
  if (!subject) return [];

  const prompt = [
    "You are choosing Bible passages for a long, calm instrumental video.",
    `Theme: ${subject}`,
    `List exactly ${wanted} short passages that suit that theme.`,
    "Each should be one to three verses — long enough to stand alone, short enough to speak in under twenty seconds.",
    "Return ONLY the references, one per line, in the form \"Book Chapter:Verse\" or \"Book Chapter:Verse-Verse\".",
    "No numbering, no commentary, no verse text.",
  ].join("\n");

  let raw = "";
  try {
    raw = String((await _llm(prompt)) || "");
  } catch {
    // No model, no key, a rate limit — the curated list covers it.
    return [];
  }

  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    // Cut the reference out of the line rather than trying to strip everything
    // around it: models append "— a verse about rest" or "(peace)" however
    // firmly you ask them not to, and each needs its own strip rule. Matching
    // "<book words> <chapter>:<verse>[-verse]" ignores all of it at once, and
    // also handles the leading "1." of a numbered list without mistaking it
    // for the "1" of "1 Corinthians".
    const m = line.match(
      /((?:[1-3]\s+)?[A-Za-z]+(?:\s+(?:of\s+)?[A-Za-z]+)*\s*\d+\s*:\s*\d+(?:\s*[-–—]\s*\d+)?)/,
    );
    if (!m) continue;
    const parsed = normalizeReference(m[1].trim());
    if (!parsed) continue;
    if (out.includes(parsed.canonical)) continue;
    out.push(parsed.canonical);
    if (out.length >= wanted) break;
  }
  return out;
}

/**
 * `count` references for a theme, guaranteed non-empty for count >= 1.
 *
 * The curated list tops up a short model answer and stands in entirely for a
 * missing one; it cycles if a session asks for more drops than it holds, which
 * over a two-hour video means a passage recurs at most twice.
 *
 * @param {{ theme?: string, count: number }} args
 * @returns {Promise<string[]>}
 */
export async function planReferences({ theme, count }) {
  const wanted = Math.max(0, Math.round(Number(count) || 0));
  if (wanted === 0) return [];

  const suggested = await suggestReferences({ theme, count: wanted });
  const out = suggested.slice(0, wanted);
  for (let i = 0; out.length < wanted; i += 1) {
    const ref = FALLBACK_REFERENCES[i % FALLBACK_REFERENCES.length];
    // Prefer an unused passage, but never loop forever: once every fallback is
    // spoken, repeats are better than returning fewer drops than asked for.
    if (out.includes(ref) && i < FALLBACK_REFERENCES.length) continue;
    out.push(ref);
  }
  return out;
}
