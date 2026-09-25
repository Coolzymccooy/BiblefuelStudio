import { pickBestBackground, pickBackgroundWithQuality } from "./categorize.js";
import { filterPool } from "./faithFilter.js";

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
 *   1. explicit `beats` (array of strings, e.g. overlay lines) -> one pick each
 *   2. structured `script` -> up to `maxBackgrounds` per-beat picks
 *   3. flat `text` (e.g. a transcript) -> a single mood-matched pick
 *   4. none of the above -> a single random pick from the pool
 *
 * An empty `pool` returns `{ backgrounds: [] }` — the signal for the caller to
 * fall back to AI image generation.
 *
 * @param {{ pool?: any[], script?: object, text?: string, beats?: string[], maxBackgrounds?: number }} params
 * @returns {{ backgrounds: any[], beats: { label: string, text: string }[] }}
 */
export function selectBackgroundsForScript({ pool, script, text, beats: beatsInput, maxBackgrounds = 4 } = {}) {
  // Faith screen FIRST, before any mood matching. @Biblefuel is a Christian
  // page; stock libraries return mosques/temples for innocent queries like
  // "prayer" or "worship", and an auto-published verse over a mosque is an
  // unrecoverable mistake. Filtering at the pool entry point means every
  // downstream selection path (beats, script, text, random) inherits it.
  const screened = filterPool(pool);
  if (screened.removed.length > 0) {
    const terms = [...new Set(screened.removed.map((r) => r.term))].join(", ");
    console.log(`[AUTOBG] Faith filter removed ${screened.removed.length} background(s) from the pool (matched: ${terms})`);
  }
  const items = screened.kept;
  const cap = Math.max(1, Number(maxBackgrounds) || 1);

  let beats;
  if (Array.isArray(beatsInput)) {
    // Explicit per-beat text (e.g. RenderPage overlay lines). Each non-blank
    // entry is its own beat.
    beats = beatsInput
      .map((t, i) => ({ label: `line${i + 1}`, text: String(t || "").trim() }))
      .filter((b) => b.text.length > 0)
      .slice(0, cap);
  } else {
    beats = deriveBeats(script).slice(0, cap);
  }
  if (beats.length === 0) {
    // No structured script: degrade to a single beat. Use the flat text (a
    // transcript) for mood when present, otherwise an empty beat -> random.
    beats = [{ label: "all", text: String(text || "").trim() }];
  }

  if (items.length === 0) return { backgrounds: [], beats, weakMatches: 0, totalBeats: beats.length };

  const backgrounds = [];
  const used = new Set();
  let weakMatches = 0;
  for (const beat of beats) {
    // Prefer clips we haven't used yet so the sequence varies; fall back to the
    // full pool once we've exhausted the distinct options.
    let candidatePool = items;
    if (items.length > 1) {
      const fresh = items.filter((it) => !used.has(it.id));
      candidatePool = fresh.length > 0 ? fresh : items;
    }
    const { item: picked, quality } = pickBackgroundWithQuality(candidatePool, {
      script: beat.text ? { hook: beat.text } : undefined,
    });
    if (picked) {
      backgrounds.push(picked);
      used.add(picked.id);
      // "random" means nothing in the library matched this beat's mood — the
      // caller may prefer to AI-generate rather than ship a mismatch.
      if (quality === "random") weakMatches += 1;
    }
  }

  return { backgrounds, beats, weakMatches, totalBeats: beats.length };
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
  beats: beatsInput,
  maxBackgrounds = 4,
  generateImage,
  generateArgs = {},
} = {}) {
  const { backgrounds, beats, weakMatches, totalBeats } = selectBackgroundsForScript({
    pool,
    script,
    text,
    beats: beatsInput,
    maxBackgrounds,
  });

  // A pick is "weak" when nothing in the library matched the beat's mood and the
  // picker fell back to a random clip — that is how a verse about anxiety lands
  // on a celebration background. When EVERY beat is weak and we can generate,
  // prefer a purpose-made image over a wholly mismatched library sequence.
  // Partial matches are kept: some real mood matching beats none.
  const allWeak = backgrounds.length > 0 && weakMatches === totalBeats;
  if (allWeak && typeof generateImage === "function") {
    const verseText = beats[0]?.text || String(text || "").trim();
    try {
      const gen = await generateImage({ beatType: "verse", verseText, ...generateArgs });
      if (gen && gen.ok && gen.path) {
        console.log(`[AUTOBG] No mood match across ${totalBeats} beat(s) — generated a purpose-made background instead`);
        return { backgroundIds: [String(gen.path)], source: "generated-no-match", beats };
      }
    } catch (e) {
      // Generation is an UPGRADE path, never a gate: if it fails we still have
      // usable library clips, and a post going out beats a post blocked on an
      // image provider.
      console.warn(`[AUTOBG] Generation fallback failed, using library picks: ${e?.message || e}`);
    }
  }

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
