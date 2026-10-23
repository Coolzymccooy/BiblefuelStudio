/**
 * The "what would make this powerful" part of a scene script: voice hints
 * ("a deep male narrator", "a gentle female voice reading Paul's
 * declaration") and the ensemble chant ("an ensemble ... can softly repeat:
 * > "By His grace… I am what I am.""). Nothing here is ever spoken except
 * the chant text, which is the author's own words.
 */

const ENSEMBLE_RE = /\b(ensemble|choir|chorus|congregation|group of voices)\b/i;
const CHANT_LEAD_RE = /\b(repeat|chant|echo|respond|say|sing|whisper)\b[^:]*:\s*(.*)$/i;

function genderOf(clause) {
  if (/\b(female|woman|women|girl)\b/i.test(clause)) return "female";
  if (/\b(male|man|men|boy)\b/i.test(clause)) return "male";
  return null;
}

function roleOf(clause) {
  if (/\bnarrator\b/i.test(clause)) return "Narrator";
  if (/\b(voice|reader)\b/i.test(clause) && /\b(scripture|verse|declaration|paul|bible|passage|reading)\b/i.test(clause)) {
    return "Scripture";
  }
  return null;
}

function readVoiceHints(text, hints) {
  let found = false;
  for (const clause of text.split(/,\s*and\s+|;\s*|\.\s+/)) {
    const role = roleOf(clause);
    if (role) {
      const gender = genderOf(clause);
      hints[role] = { ...hints[role], ...(gender ? { gender } : {}), notes: clause.trim() };
      found = true;
    }
    if (ENSEMBLE_RE.test(clause)) {
      hints.Ensemble = {
        ...hints.Ensemble,
        adults: /\badults?\b/i.test(clause) || hints.Ensemble.adults || false,
        children: /\b(child|children|kids)\b/i.test(clause) || hints.Ensemble.children || false,
        notes: clause.trim(),
      };
      found = true;
    }
  }
  return found;
}

const unquote = (s) => String(s || "").replace(/^>\s*/, "").replace(/\*\*/g, "").trim().replace(/^["“]|["”]$/g, "").trim();

/**
 * @param {Array<{lineNo: number, text: string}>} rows
 * @returns {{ voiceHints: object, chantText: string, used: number[], ignored: Array<{lineNo: number, text: string}> }}
 */
export function readAdvice(rows) {
  const voiceHints = { Narrator: {}, Scripture: {}, Ensemble: {} };
  const used = [];
  const ignored = [];
  let chantText = "";
  let expectChant = false;
  for (const { lineNo, text } of rows) {
    if (/^>/.test(text) && (expectChant || !chantText)) {
      if (!chantText) chantText = unquote(text);
      used.push(lineNo);
      expectChant = false;
      continue;
    }
    const hinted = readVoiceHints(text, voiceHints);
    const lead = CHANT_LEAD_RE.exec(text);
    if (lead && ENSEMBLE_RE.test(text)) {
      const inline = unquote(lead[2]);
      if (inline && !chantText) chantText = inline;
      else expectChant = !inline;
    }
    if (hinted || lead) used.push(lineNo);
    else ignored.push({ lineNo, text });
  }
  return { voiceHints, chantText, used, ignored };
}
