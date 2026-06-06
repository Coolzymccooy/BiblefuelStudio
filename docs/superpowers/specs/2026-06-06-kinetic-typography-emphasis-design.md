# Kinetic Typography — Semantic Emphasis Engine + 3-Tier Sizing + Phrase Chunking

**Date:** 2026-06-06
**Branch:** `worktree-feat-kinetic-typography-emphasis` (off `master` @ f5136df)
**Scope:** Server-side only. No new render engine. Pure functions, TDD.

## Background

The "Cinematic Kinetic Typography" proposal asked for a premium kinetic-text
renderer. A review against the codebase found ~70% already shipped: the FFmpeg
`drawtext` word-level pipeline, word timing (Azure native / ElevenLabs char→word
/ Whisper fallback), 11 typography presets, per-beat auto-backgrounds, and an
animation picker. The proposal's Remotion recommendation was rejected — it would
replace a tested production pipeline.

This spec covers the genuinely-missing rendering-quality core. Deferred:
layout variety, preview-player UI, LLM scoring, glow/blur/particles.

## Problems being fixed

1. **Emphasis is length-based, not semantic.** `pickKeyword()` emphasizes the
   longest non-stopword. It has no idea "Lord", "mercy", "fear", "shepherd"
   carry weight.
2. **Only one word per phrase is emphasized**, and there are only two sizes
   (normal + emphasis). Reference clips mix several sizes and emphasize 2–3
   words.
3. **No micro-phrase chunking.** Text groups by beat/line, not short emotional
   fragments ("The Lord" / "is my shepherd").

## Design

### Component 1 — `server/src/lib/emphasisLexicon.js` (new)

Pure, deterministic, no I/O. Categorized scripture/emotion word sets with weights:

| Category | Examples | Weight |
|---|---|---|
| deity      | lord, god, jesus, christ, spirit, father, shepherd, king, almighty | 5 |
| hope       | mercy, grace, peace, hope, love, faith, joy, glory, victory, saved, blessed | 4 |
| action     | rise, fight, run, follow, conquer, overcome, stand, arise, pursue | 3 |
| fear       | fear, death, evil, darkness, sin, lost, fall, enemy, trouble | 3 |

Exports:
- `scoreWord(token) → number` — normalized token (lowercased, punctuation
  stripped) → category weight, else `0`.
- `categoryOf(token) → string | null`.

Tokenizer mirrors `captions.js` (`replace(/[^A-Za-z0-9']/g, "")`).
No lexicon hit → score 0, preserving the longest-word fallback downstream.

### Component 2 — `annotateEmphasisTiers(words, lines)` in `captions.js`

Returns each word tagged `level: "normal" | "key" | "hero"`:
- Lexicon hit → `key`; if no word in a phrase scores, the existing
  `pickKeyword` longest-word becomes the single `key` (fallback preserved).
- Highest-scoring word **per phrase** → `hero` (at most one). Ties broken by
  earliest word.
- Backward compat: `emphasize: true` also set for `key` + `hero` so existing
  callers/tests/`buildWordDrawtext` keep working unchanged.
- The original `annotateEmphasis` is left untouched.

Phrase boundaries for hero selection come from `lines` when provided, else the
whole list is one phrase. (When wired to `splitPhrases` output, each phrase is a
line.)

### Component 3 — `splitPhrases(words, opts)` in `captions.js`

Groups timed `words[]` into short fragments. Default `maxWords: 3`,
`maxChars: 22`. Breaks on terminal punctuation (`.,;:!?`) first, then on the
word/char limits. Each phrase: `{ text, start, end, words }` (start/end from
member words). Does not alter `groupWordsByBeat`.

### Component 4 — hero size tier in `videoFilters.js`

- Add optional `heroSizeMult` + `heroColor` to presets. Defaults when omitted:
  `heroSizeMult = emphasisSizeMult * 1.25`, `heroColor = emphasisColor`. So
  untouched presets keep identical output for non-hero words.
- `buildWordDrawtext`: compute `heroSize`; pick size/color by `word.level`
  (`hero` → hero, `key`/`emphasize` → emphasis, else base). The existing
  `fitSize` width-clamp still applies. Motion/reveal logic unchanged.

### Data flow (unchanged pipeline, richer tags)

```
TTS words[] → splitPhrases → annotateEmphasisTiers (lexicon + fallback, 1 hero/phrase)
            → words[{text,start,end,level,emphasize}] → buildWordDrawtext → FFmpeg → mp4
```

## Testing (TDD, `node --test`)

- `emphasisLexicon.test.js` — scoring per category, casing, punctuation,
  unknown → 0, category lookup.
- `captions.test.js` additions — tiers; exactly one hero per phrase; fallback to
  longest-word when no lexicon hit; phrase splitting on punctuation and on
  word/char limits; backward-compat `emphasize` flag.
- `kineticAnimations.test.js` additions — hero word gets hero size & color;
  presets without hero fields fall back to emphasis size (no regression);
  key/normal unchanged.

## Out of scope

Layout variety (bottom-left/staggered), preview-player UI, LLM scoring,
glow/blur/particles. The `scoreWord` interface is shaped so an LLM scorer can
slot in later behind the same contract.
