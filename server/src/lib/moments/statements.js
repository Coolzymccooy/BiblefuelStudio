import { defaultLlmComplete } from "../story/scriptRefine.js";
import { normalizeReference } from "../bible/bibleReference.js";
import { lookupVerses } from "../bible/scriptureApi.js";
import { resolveOccasion, statementLimit, templatesFor, TITLE_MAX, STATEMENT_MAX, OCCASIONS } from "./occasions.js";

/**
 * Statement ideas for a Moment. The AI gets 15 s; anything unusable (an
 * error, a timeout, prose instead of JSON) falls back to the occasion's
 * templates, so the user always has editable text. A verse is only ever a
 * reference from the AI: its words come from the Bible lookup.
 */
export const AI_TIMEOUT_MS = 15_000;
/** The verse lookup gets its own bound so a stalled scripture API yields no verse, not a hung request. */
export const VERSE_TIMEOUT_MS = 5_000;

/** A verse is shown only when the reference names up to this many verses past the first. */
const MAX_VERSE_SPAN = 3;

let _llm = defaultLlmComplete;
export function _setLlmImpl(impl) { _llm = impl; }
export function _resetLlmImpl() { _llm = defaultLlmComplete; }
let _lookup = lookupVerses;
export function _setLookupImpl(impl) { _lookup = impl; }
export function _resetLookupImpl() { _lookup = lookupVerses; }

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/** The first {...} block in the text, parsed; null if there is none or it is not JSON. */
function parseJson(raw) {
  const s = String(raw || "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

const tidy = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

function buildPrompt(occ, details, limit) {
  const known = Object.entries(details || {})
    .map(([k, v]) => [k, tidy(v)])
    .filter(([, v]) => v)
    .map(([k, v]) => `- ${k}: ${v}`);
  return [
    `Write on-screen text for a short ${occ.label.toLowerCase()} photo video for social media.`,
    "Warm, faith-friendly, celebratory where it fits. Plain words, no emojis, no hashtags.",
    `Return a title (at most ${TITLE_MAX} characters) and ${limit} statements (each at most ${STATEMENT_MAX} characters, ideally 2-6 words).`,
    "Use only the details given; never invent facts about the person.",
    occ.church ? "Also suggest one fitting Bible verse reference, like \"Psalm 118:24\" (reference only)." : "Leave verseReference empty.",
    "Details:",
    ...(known.length ? known : ["- none"]),
    "Answer with JSON only: {\"title\": \"...\", \"statements\": [\"...\"], \"verseReference\": \"...\"}",
  ].join("\n");
}

/** The looked-up KJV text for a single verse or a short range; undefined for anything else. */
async function verseFor(reference) {
  const ref = tidy(reference);
  if (!ref) return undefined;
  const parsed = normalizeReference(ref);
  if (!parsed || parsed.verseFrom == null) return undefined;
  if ((parsed.verseTo ?? parsed.verseFrom) - parsed.verseFrom > MAX_VERSE_SPAN) return undefined;
  try {
    const looked = await _lookup(parsed.canonical, "kjv");
    const text = tidy((looked?.verses || []).map((v) => v.text).join(" "));
    return text ? { reference: looked.canonical || parsed.canonical, text } : undefined;
  } catch {
    return undefined;
  }
}

export async function suggestStatements({
  occasion, details = {}, lengthSec = 15, timeoutMs = AI_TIMEOUT_MS, verseTimeoutMs = VERSE_TIMEOUT_MS,
}) {
  const occ = resolveOccasion(occasion) || OCCASIONS.fun;
  const limit = statementLimit(lengthSec);
  const fallback = templatesFor(occ.id, details, lengthSec);
  let parsed = null;
  try {
    parsed = parseJson(await withTimeout(Promise.resolve().then(() => _llm(buildPrompt(occ, details, limit))), timeoutMs));
  } catch {
    parsed = null;
  }
  const aiStatements = Array.isArray(parsed?.statements)
    ? parsed.statements
      .filter((s) => typeof s === "string")
      .map(tidy)
      .filter((s) => s && s.length <= STATEMENT_MAX)
      .slice(0, limit)
    : [];
  const aiTitle = tidy(parsed?.title);
  const useAi = aiStatements.length > 0;
  const result = {
    title: useAi && aiTitle && aiTitle.length <= TITLE_MAX ? aiTitle : fallback.title,
    statements: useAi ? aiStatements : fallback.statements,
    source: useAi ? "ai" : "template",
  };
  if (occ.church && useAi) {
    const verse = await withTimeout(verseFor(parsed.verseReference), verseTimeoutMs).catch(() => undefined);
    if (verse) result.verse = verse;
  }
  return result;
}
