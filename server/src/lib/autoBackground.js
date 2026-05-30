import { pickBestBackground } from "./categorize.js";

/**
 * Derive the ordered "beats" of a script — the segments that each deserve their
 * own mood-matched background. Mirrors the weighting used elsewhere: hook,
 * verse (+reference for extra mood signal), reflection, then CTA.
 *
 * @param {object|null|undefined} script
 * @returns {{ label: string, text: string }[]}
 */
function deriveBeats(script) {
  if (!script || typeof script !== "object") return [];
  const candidates = [
    { label: "hook", text: script.hook },
    {
      label: "verse",
      text: script.reference ? `${script.verse || ""} ${script.reference}` : script.verse,
    },
    { label: "reflection", text: script.reflection },
    { label: "cta", text: script.cta },
  ];
  return candidates
    .map((b) => ({ label: b.label, text: String(b.text || "").trim() }))
    .filter((b) => b.text.length > 0);
}

/**
 * Auto-select backgrounds from a user's own library pool — one mood-matched
 * clip per script beat, so longer videos don't sit on a single background.
 *
 * Reuses {@link pickBestBackground} verbatim for the actual mood matching; this
 * helper only handles beat segmentation and "don't repeat the last clip".
 *
 * Selection layers (caller's responsibility for what comes after):
 *   1. structured `script` -> up to `maxBackgrounds` per-beat picks
 *   2. flat `text` (e.g. a transcript) -> a single mood-matched pick
 *   3. neither -> a single random pick from the pool
 *
 * An empty `pool` returns `{ backgrounds: [] }` — the signal for the caller to
 * fall back to AI image generation.
 *
 * @param {{ pool?: any[], script?: object, text?: string, maxBackgrounds?: number }} params
 * @returns {{ backgrounds: any[], beats: { label: string, text: string }[] }}
 */
export function selectBackgroundsForScript({ pool, script, text, maxBackgrounds = 4 } = {}) {
  const items = Array.isArray(pool) ? pool : [];
  const cap = Math.max(1, Number(maxBackgrounds) || 1);

  let beats = deriveBeats(script).slice(0, cap);
  if (beats.length === 0) {
    // No structured script: degrade to a single beat. Use the flat text (a
    // transcript) for mood when present, otherwise an empty beat -> random.
    beats = [{ label: "all", text: String(text || "").trim() }];
  }

  if (items.length === 0) return { backgrounds: [], beats };

  const backgrounds = [];
  const used = new Set();
  for (const beat of beats) {
    // Prefer clips we haven't used yet so the sequence varies; fall back to the
    // full pool once we've exhausted the distinct options.
    let candidatePool = items;
    if (items.length > 1) {
      const fresh = items.filter((it) => !used.has(it.id));
      candidatePool = fresh.length > 0 ? fresh : items;
    }
    const picked = pickBestBackground(candidatePool, {
      script: beat.text ? { hook: beat.text } : undefined,
    });
    if (picked) {
      backgrounds.push(picked);
      used.add(picked.id);
    }
  }

  return { backgrounds, beats };
}

/**
 * Resolve an "auto background" request into concrete identifiers the render
 * route can pass through its normal resolution. Reuses
 * {@link selectBackgroundsForScript} to pick from the user's own pool; when the
 * pool is empty it falls back to AI image generation via the injected
 * `generateImage` function (injected so this stays unit-testable without hitting
 * real providers).
 *
 * @param {object} params
 * @param {any[]}  [params.pool]            user's library items
 * @param {object} [params.script]          structured script (hook/verse/...)
 * @param {string} [params.text]            flat transcript text fallback
 * @param {number} [params.maxBackgrounds]
 * @param {(args:object)=>Promise<{ok:boolean,path?:string,error?:string}>} params.generateImage
 * @param {object} [params.generateArgs]    extra args forwarded to generateImage
 * @returns {Promise<{ backgroundIds: string[], source: "library"|"generated"|"none", beats: any[], error?: string }>}
 */
export async function resolveAutoBackgrounds({
  pool,
  script,
  text,
  maxBackgrounds = 4,
  generateImage,
  generateArgs = {},
} = {}) {
  const { backgrounds, beats } = selectBackgroundsForScript({
    pool,
    script,
    text,
    maxBackgrounds,
  });

  if (backgrounds.length > 0) {
    return {
      backgroundIds: backgrounds.map((b) => String(b.id)),
      source: "library",
      beats,
    };
  }

  // Empty pool -> AI-generate a single background from the script's strongest
  // mood signal (the first beat / hook).
  if (typeof generateImage === "function") {
    const verseText = beats[0]?.text || String(text || "").trim();
    const gen = await generateImage({ beatType: "verse", verseText, ...generateArgs });
    if (gen && gen.ok && gen.path) {
      return { backgroundIds: [String(gen.path)], source: "generated", beats };
    }
    return {
      backgroundIds: [],
      source: "none",
      beats,
      error:
        (gen && gen.error) ||
        "Your background library is empty and AI image generation is unavailable — add a background to continue.",
    };
  }

  return {
    backgroundIds: [],
    source: "none",
    beats,
    error: "Your background library is empty — add a background to continue.",
  };
}
