import { prepareScriptureForSpeech, numberToWords } from '../voice/scripture.js';

// Preserve authored text separately from supplied timing. Structural/lexical
// validation does not establish acoustic accuracy. No-timing drafts are estimates.

/**
 * Distribute words evenly across a known audio duration.
 *
 * Fallback for providers that synthesize without timestamps. Word LENGTH is
 * used as the weight rather than a flat split, because "Nebuchadnezzar" plainly
 * takes longer to say than "of" — a small refinement that keeps scene
 * boundaries from landing mid-phrase.
 *
 * @param {string[]} words
 * @param {number} durationMs total narration length
 * @returns {Array<{text:string,startMs:number,endMs:number}>}
 */
export function buildEvenWordTimings(words, durationMs) {
  const list = (Array.isArray(words) ? words : []).map((w) => String(w || "").trim()).filter(Boolean);
  const total = Math.max(0, Number(durationMs) || 0);
  if (list.length === 0 || total === 0) return [];

  const weights = list.map((w) => Math.max(1, w.length));
  const weightTotal = weights.reduce((a, b) => a + b, 0);

  const out = [];
  let cursor = 0;
  list.forEach((text, i) => {
    const share = (weights[i] / weightTotal) * total;
    const startMs = Math.round(cursor);
    // Clamp the final word to the exact duration so rounding never overshoots
    // the audio — scene segmentation trusts the last endMs as the total.
    const endMs = i === list.length - 1 ? Math.round(total) : Math.round(cursor + share);
    out.push({ text, startMs, endMs });
    cursor += share;
  });
  return out;
}

/** Normalize the entire source, never a valid-looking subset. */
export function normalizeWordTimings(words) {
  if (!Array.isArray(words) || !words.length) return [];
  const out = [];
  for (const w of words) {
    const text = w?.text ?? w?.word;
    const start = w?.startMs !== undefined ? w.startMs
      : w?.start_ms !== undefined ? w.start_ms : typeof w?.start === 'number' ? w.start * 1000 : undefined;
    const end = w?.endMs !== undefined ? w.endMs
      : w?.end_ms !== undefined ? w.end_ms : typeof w?.end === 'number' ? w.end * 1000 : undefined;
    if (typeof text !== 'string' || !text.trim() || !Number.isFinite(start) ||
        !Number.isFinite(end) || start < 0 || end <= start ||
        (out.length && (start < out.at(-1).startMs || end < out.at(-1).endMs))) return [];
    out.push({ text: text.trim(), startMs: start, endMs: end });
  }
  return out;
}

// Keep numeric signs, decimals and internal reference separators meaningful.
function tokenKey(text) {
  const normalized = text.normalize('NFKC').toLowerCase().replace(/[’‘]/gu, "'");
  // Signs, decimal points and reference separators may carry numeric meaning.
  // Require exact numeral spelling rather than guessing punctuation semantics.
  if (/\p{N}/u.test(normalized)) return normalized;
  const stripped = normalized.replace(/^[\p{P}]+|[\p{P}]+$/gu, '');
  return stripped || (/^[-—–.,!?;:…'"“”‘’()[\]{}]+$/u.test(normalized) ? '' : normalized);
}

// Whitelist only the deterministic scripture synthesizer's chapter:verse/range
// expansion. Never use fuzzy alignment or fill missing native boundaries.
function keys(text) {
  return String(text).trim().split(/\s+/u).filter(Boolean).map(tokenKey).filter(Boolean);
}
function referenceTargets(tokens, script) {
  const targets = tokens.map(t => [tokenKey(t)].filter(Boolean));
  for (let i = 0; i < tokens.length; i++) {
    const m = tokens[i].match(/^(\d+):(\d+)(?:-(\d+)|(-))?([.,!?;:…’”"')\]]*)$/u);
    if (!m) continue;
    let end = m[3], last = i;
    // The synthesizer permits whitespace on either side of the range hyphen.
    // Keep each author token; only a standalone hyphen has no spoken span.
    if (!end) {
      const next = tokens[i + 1] || '';
      const endpoint = m[4] ? next.match(/^(\d+)[.,!?;:…’”"')\]]*$/u)
        : next.match(/^-(\d+)[.,!?;:…’”"')\]]*$/u);
      if (endpoint) { end = endpoint[1]; last = i + 1; }
      else if (!m[4] && next === '-') {
        const separated = (tokens[i + 2] || '').match(/^(\d+)[.,!?;:…’”"')\]]*$/u);
        if (separated) { end = separated[1]; last = i + 2; }
      }
      if (m[4] && !end) continue;
    }
    const suffix = prepareScriptureForSpeech(`John ${m[1]}:${m[2]}${end ? `-${end}` : ''}`).replace(/^John /u, '');
    if (last === i) targets[i] = keys(suffix);
    else {
      targets[i] = keys(`chapter ${numberToWords(Number(m[1]))}, verses ${numberToWords(Number(m[2]))}`);
      targets[i + 1] = [];
      targets[last] = keys(`to ${numberToWords(Number(end))}`);
    }
  }
  // A numeric-looking token alone is not evidence of a Bible reference. The
  // WHOLE result must equal the existing synthesizer's actual transformation.
  if (JSON.stringify(targets.flat()) !== JSON.stringify(keys(prepareScriptureForSpeech(script)))) return null;
  return targets;
}

function mapComplete(tokens, provided, targets) {
  if (!targets) return null;
  let cursor = 0;
  const spans = [];
  for (let i = 0; i < tokens.length; i++) {
    const from = cursor;
    for (const key of targets[i]) {
      if (!provided[cursor] || tokenKey(provided[cursor].text) !== key) return null;
      cursor++;
    }
    spans.push({ tokenIndex: i, spokenStart: from, spokenEnd: cursor });
  }
  if (cursor !== provided.length) return null;
  return spans;
}

export function buildImportedTranscript({ script, audioPath, durationMs, words, spokenText, tokenMap, timing }) {
  const originalScript = String(script ?? '');
  const tokens = originalScript.trim().split(/\s+/u).filter(Boolean);
  if (!tokens.length) throw new Error('script import: no words to build a transcript from');
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error('script import: durationMs must be a positive measured audio duration');
  }
  const supplied = words !== undefined && words !== null && !(Array.isArray(words) && words.length === 0);
  let resolved;
  if (supplied) {
    const provided = normalizeWordTimings(words);
    if (!provided.length || provided.some(w => w.endMs > durationMs)) {
      throw new Error('script import: invalid word timings; supply complete ordered positive timestamps within the measured audio duration, or omit words for an estimated draft');
    }
    // Ignore punctuation-only native entries only when they really are
    // punctuation. Every lexical boundary must be consumed exactly once.
    const lexical = provided.filter(w => tokenKey(w.text));
    let spans = mapComplete(tokens, lexical, tokens.map(t => [tokenKey(t)].filter(Boolean)));
    if (!spans) spans = mapComplete(tokens, lexical, referenceTargets(tokens, originalScript));
    if (!spans || (spokenText !== undefined &&
        JSON.stringify(keys(spokenText)) !== JSON.stringify(lexical.map(w => tokenKey(w.text)))) ||
        (tokenMap !== undefined && (!Array.isArray(tokenMap) || tokenMap.length !== spans.length ||
          tokenMap.some((span, i) => !span || span.tokenIndex !== spans[i].tokenIndex ||
            span.spokenStart !== spans[i].spokenStart || span.spokenEnd !== spans[i].spokenEnd)))) {
      throw new Error('script import: timing/script mismatch; supply timings for every script token in order. Unsupported expansion requires explicit script-to-audio alignment; partial or unrelated words cannot be imported');
    }
    resolved = spans.map(({ tokenIndex, spokenStart, spokenEnd }) => ({
      text: tokens[tokenIndex],
      startMs: lexical[spokenStart]?.startMs ?? lexical.at(-1)?.endMs ?? 0,
      endMs: spokenEnd > spokenStart ? lexical[spokenEnd - 1].endMs
        : lexical[spokenStart]?.startMs ?? lexical.at(-1)?.endMs ?? 0,
    }));
  } else {
    resolved = buildEvenWordTimings(tokens, durationMs);
    if (resolved.some(w => w.endMs <= w.startMs)) {
      throw new Error('script import: measured audio duration is too short for an estimated draft');
    }
  }
  return {
    source: { audioPath: String(audioPath), durationMs },
    transcript: {
      script: originalScript,
      words: resolved,
      hash: `${durationMs}:${resolved.length}`,
      timing: {
        provenance: !supplied ? 'estimated' : timing?.provenance === 'section-spread' ? 'section-spread' : 'supplied',
        accuracy: !supplied || timing?.estimated === true || timing?.provenance === 'section-spread' ? 'estimated' : 'unknown',
        estimated: !supplied || timing?.estimated === true || timing?.provenance === 'section-spread',
        verified: false,
      },
    },
  };
}
