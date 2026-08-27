// FFmpeg filter-graph builders for the new word-level captions and
// scene-splitter pipelines. Pure functions — no fs/spawn/network. Each
// returns plain strings (or arrays of strings) the caller assembles into
// the final ffmpeg invocation.

import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Bundled caption fonts. Every caption used to render in ffmpeg's default
 * monospace, which is what made our output read as "generated" beside a
 * reference ad using script, marker and serif-italic faces. Motion was never
 * the gap; the typeface was.
 *
 * These live in the repo (OFL / Apache) rather than being read from the OS:
 * system fonts are not redistributable and do not exist on the Linux server.
 */
const BACKSLASH = String.fromCharCode(92);

export const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "fonts");

const FONT_FILES = Object.freeze({
  marker: "PermanentMarker.ttf",
  script: "Caveat-Bold.ttf",
  serif: "PlayfairDisplay-BoldItalic.ttf",
  poster: "Anton.ttf",
});

/**
 * Escape a path for use inside a drawtext option. An unescaped Windows drive
 * colon terminates the option and takes the whole filtergraph down with it.
 */
export function escapeFontPath(p) {
  // ffmpeg needs the drive colon escaped: a bare "C:" ends the drawtext
  // option and the whole filtergraph is rejected.
  return String(p).split(BACKSLASH).join("/").split(":").join(BACKSLASH + ":");
}

/** Absolute, ffmpeg-escaped font path for a preset, or "" for monospace. */
export function fontFileFor(style) {
  const key = style?.fontFamily;
  const file = key && FONT_FILES[key];
  if (!file) return "";
  return path.join(FONT_DIR, file);
}

function fontArg(style) {
  const f = fontFileFor(style);
  return f ? `:fontfile='${escapeFontPath(f)}'` : "";
}

const DEFAULT_XFADE_SECONDS = 0.5;
const EMPHASIS_COLOR = "#F59E0B";
const BASE_TEXT_COLOR = "white";

// Typography presets map a narration category (from voice/profiles.js) to a
// concrete drawtext styling. Keep the structure simple — multipliers against
// the frame height so presets scale cleanly across aspects, plus a colour
// pair. `wordBox` controls whether word captions get a translucent backdrop,
// useful when busy backgrounds wash out plain text.
const TYPOGRAPHY_PRESETS = Object.freeze({
  "cinematic-default": {
    baseSizeMult: 0.07,
    emphasisSizeMult: 0.085,
    baseColor: "white",
    emphasisColor: "#F59E0B",
    borderWidth: 5,
    wordBox: false,
    lineBoxOpacity: 0.35,
    lineSizeMult: 0.033,
  },
  "intimate-fade": {
    baseSizeMult: 0.058,
    emphasisSizeMult: 0.068,
    baseColor: "#F5F1E6",
    emphasisColor: "#FBBF24",
    borderWidth: 3,
    wordBox: false,
    lineBoxOpacity: 0.45,
    lineSizeMult: 0.030,
  },
  "scripture-emphasis": {
    baseSizeMult: 0.065,
    emphasisSizeMult: 0.085,
    baseColor: "white",
    emphasisColor: "#FCD34D",
    borderWidth: 6,
    wordBox: true,
    lineBoxOpacity: 0.5,
    lineSizeMult: 0.036,
  },
  "playful-pop": {
    baseSizeMult: 0.075,
    emphasisSizeMult: 0.095,
    baseColor: "white",
    emphasisColor: "#FB7185",
    borderWidth: 6,
    wordBox: false,
    lineBoxOpacity: 0.4,
    lineSizeMult: 0.035,
  },
  "worship-cinematic": {
    baseSizeMult: 0.07,
    emphasisSizeMult: 0.09,
    baseColor: "#FFF7ED",
    emphasisColor: "#FCD34D",
    borderWidth: 5,
    wordBox: false,
    lineBoxOpacity: 0.4,
    lineSizeMult: 0.034,
  },

  // ── Kinetic animation presets (ported from lumina-presenter) ──
  // These add MOTION fields on top of the size/colour fields above:
  //   lineEnter   "fade" | "rise-fade"            (line captions)
  //   wordReveal  "fade" | "rise-fade" | "scale-fade"  (per-word; scale-fade
  //               is approximated as fade — drawtext fontsize can't animate)
  //   wordRevealMs  reveal/ease duration in ms
  //   uppercase   render words uppercase
  //   shadow      { color, x, y } — static glow approximation
  // The legacy presets above omit these and keep the hard-cut behaviour.
  "cinematic-worship": {
    baseSizeMult: 0.072, emphasisSizeMult: 0.09, baseColor: "white", emphasisColor: "#FCD34D",
    borderWidth: 5, wordBox: false, lineBoxOpacity: 0.4, lineSizeMult: 0.034,
    lineEnter: "rise-fade", wordReveal: "fade", wordRevealMs: 380, uppercase: false,
    shadow: { color: "black@0.6", x: 0, y: 2 },
  },
  "cinematic-reactive": {
    baseSizeMult: 0.073, emphasisSizeMult: 0.092, baseColor: "white", emphasisColor: "#BFD4FF",
    borderWidth: 5, wordBox: false, lineBoxOpacity: 0.4, lineSizeMult: 0.034,
    lineEnter: "rise-fade", wordReveal: "fade", wordRevealMs: 380, uppercase: false,
    shadow: { color: "black@0.6", x: 0, y: 2 },
  },
  "scripture-reveal": {
    baseSizeMult: 0.062, emphasisSizeMult: 0.078, baseColor: "#FCF7E9", emphasisColor: "#FCD34D",
    borderWidth: 4, wordBox: false, lineBoxOpacity: 0.45, lineSizeMult: 0.032,
    lineEnter: "fade", wordReveal: "fade", wordRevealMs: 460, uppercase: false,
    shadow: { color: "black@0.7", x: 0, y: 3 },
  },
  "word-boxes": {
    baseSizeMult: 0.088, emphasisSizeMult: 0.1, baseColor: "white", emphasisColor: "#FFD166",
    borderWidth: 4, wordBox: true, lineBoxOpacity: 0.5, lineSizeMult: 0.036,
    lineEnter: "rise-fade", wordReveal: "scale-fade", wordRevealMs: 380, uppercase: true,
  },
  "hero-bold": {
    baseSizeMult: 0.092, emphasisSizeMult: 0.11, baseColor: "white", emphasisColor: "#F59E0B",
    heroSizeMult: 0.14, heroColor: "#FDE68A",
    borderWidth: 6, wordBox: false, lineBoxOpacity: 0.4, lineSizeMult: 0.04,
    lineEnter: "rise-fade", wordReveal: "rise-fade", wordRevealMs: 300, uppercase: true,
  },
  "music-video": {
    baseSizeMult: 0.08, emphasisSizeMult: 0.098, baseColor: "white", emphasisColor: "#FB7185",
    borderWidth: 5, wordBox: false, lineBoxOpacity: 0.4, lineSizeMult: 0.035,
    lineEnter: "rise-fade", wordReveal: "fade", wordRevealMs: 240, uppercase: false,
  },
  // Short-form social karaoke: the whole phrase sits on screen in heavy white
  // uppercase and the word being spoken flips to magenta. Distinct from the
  // single-hero-word styles above — the viewer reads ahead while the highlight
  // tracks the voice, which holds attention through longer narration.
  //
  // emphasisSizeMult INTENTIONALLY equals baseSizeMult: karaoke highlighting
  // recolours a word in place. Growing it would reflow the line and make the
  // surrounding words jitter on every syllable.
  //
  // No backdrop box (lineBoxOpacity 0) — a thick outline carries legibility
  // over busy footage, which is what the reference style does.
  //
  // KNOWN LIMITATION: buildWordDrawtext renders ONE word at a time, so this
  // preset currently gives the reference's colour/weight treatment but not its
  // full phrase context (reference keeps the whole 2-line phrase on screen and
  // recolours the spoken word in place). True karaoke needs a phrase-layout
  // builder that positions each word within a measured line — a larger change
  // than a preset. Tracked as follow-up work.
  "karaoke-pop": {
    baseSizeMult: 0.078, emphasisSizeMult: 0.078, baseColor: "white", emphasisColor: "#FF00FF",
    borderWidth: 8, wordBox: false, lineBoxOpacity: 0, lineSizeMult: 0.038,
    lineEnter: "fade", wordReveal: "fade", wordRevealMs: 120, uppercase: true,
    shadow: { color: "black@0.85", x: 0, y: 3 },
  },

  // ---- Marker family -----------------------------------------------------
  // Modelled on the reference the operator supplied. Three distinct looks that
  // appear across it, each usable per-word OR per-line.

  // MARKER: dark text on a saturated highlighter block. The block is the
  // style, so wordBox and a high lineBoxOpacity are load-bearing here - drop
  // either and it degrades to plain yellow text on video.
  //
  // Text is near-black rather than white: a bright block needs dark type, and
  // white-on-yellow fails contrast on any frame.
  //
  // NOT uppercase. The reference sets lowercase script, and uppercasing it
  // loses the handwritten feel that distinguishes this from word-boxes.
  "marker": {
    // Sizing verified by rendering a real frame, not by reading the numbers:
    // 0.082 put a single word edge-to-edge on a 1080x1920 portrait frame. The
    // reference block is roughly a third of the frame width.
    baseSizeMult: 0.042, emphasisSizeMult: 0.048, baseColor: "0x141210",
    emphasisColor: "0x141210",
    heroSizeMult: 0.056, heroColor: "0x141210",
    borderWidth: 0, wordBox: true, boxColor: "0xF5C518", boxOpacity: 0.95,
    boxBorderW: 18,
    lineBoxOpacity: 0.92, lineBoxColor: "0xF5C518", lineSizeMult: 0.026,
    lineEnter: "fade", wordReveal: "scale-fade", wordRevealMs: 260,
    fontFamily: "marker",
    captionMode: "lines",
    uppercase: false,
  },

  // SOFT-GLOW: pale butter-yellow with a heavy dark outline and no block.
  // Reads over busy footage without a panel, which is what makes it feel
  // lighter than marker.
  "soft-glow": {
    baseSizeMult: 0.052, emphasisSizeMult: 0.060, baseColor: "0xFAE58C",
    emphasisColor: "0xFFF3B0",
    heroSizeMult: 0.070, heroColor: "0xFFF8D0",
    borderWidth: 10, wordBox: false, lineBoxOpacity: 0, lineSizeMult: 0.028,
    lineEnter: "rise-fade", wordReveal: "scale-fade", wordRevealMs: 240,
    fontFamily: "script",
    captionMode: "lines",
    uppercase: false,
    shadow: { color: "black@0.55", x: 0, y: 6 },
  },

  // HEADLINE: the same palette at poster scale. Sits high in frame, so it does
  // not fight a face in the lower two-thirds of a portrait video.
  "headline": {
    baseSizeMult: 0.085, emphasisSizeMult: 0.095, baseColor: "0xFAE58C",
    emphasisColor: "0xFFF3B0",
    heroSizeMult: 0.105, heroColor: "0xFFF8D0",
    borderWidth: 8, wordBox: false, lineBoxOpacity: 0, lineSizeMult: 0.034,
    lineEnter: "rise-fade", wordReveal: "scale-fade", wordRevealMs: 220,
    fontFamily: "serif",
    captionMode: "lines",
    uppercase: false, layout: "center",
    shadow: { color: "black@0.45", x: 0, y: 8 },
  },
});

// The lumina-presenter design-animation catalog, ported. Browser-only effects
// (particles, WebGL bloom, 3D extrude, metal/glass/video fill, audio-reactive
// pulsing) can't render in ffmpeg drawtext, so each entry declares whether it
// is `renderable` server-side and lists the `unsupported` effects. Every entry
// maps to a real `presetId` so non-renderable picks degrade to a close style
// instead of crashing.
const KINETIC_ANIMATIONS = Object.freeze([
  // Marker family. Fully renderable server-side: no browser-only effects, so
  // what the picker previews is what ffmpeg burns.
  { id: "marker", label: "Marker", description: "Dark handwriting on a yellow highlighter block. Works per word or per line.", presetId: "marker", renderable: true, unsupported: [] },
  { id: "soft-glow", label: "Soft Glow", description: "Pale butter type with a heavy dark outline. No block, reads over busy footage.", presetId: "soft-glow", renderable: true, unsupported: [] },
  { id: "headline", label: "Headline", description: "Poster-scale pale type set high in frame, clear of faces.", presetId: "headline", renderable: true, unsupported: [] },
  { id: "cinematic-worship", label: "Cinematic Worship", description: "Centered large worship typography; lines rise in, words fade one at a time.", presetId: "cinematic-worship", renderable: true, unsupported: [] },
  { id: "cinematic-reactive", label: "Cinematic Reactive", description: "Cinematic worship type that glows/pulses to audio with drifting particles (audio-reactivity is browser-only).", presetId: "cinematic-reactive", renderable: true, unsupported: ["audio-reactive", "particles"] },
  { id: "scripture-reveal", label: "Scripture Reveal", description: "Slow, reverent verse reveal; long dwell, gentle fade.", presetId: "scripture-reveal", renderable: true, unsupported: [] },
  { id: "word-boxes", label: "Word Boxes", description: "Bold uppercase words on backdrop panels (per-word colour grid + 3D extrude are browser-only).", presetId: "word-boxes", renderable: true, unsupported: ["per-word-colour-grid", "3d-extrude"] },
  { id: "hero-bold", label: "Hero Bold", description: "Huge bold uppercase words that rise and fade in.", presetId: "hero-bold", renderable: true, unsupported: [] },
  { id: "music-video", label: "Music Video", description: "Snappy, fast-paced word reveals.", presetId: "music-video", renderable: true, unsupported: [] },
  { id: "karaoke-pop", label: "Karaoke Pop", description: "Bold white uppercase phrase with the spoken word highlighted magenta — the short-form social caption style.", presetId: "karaoke-pop", renderable: true, unsupported: [] },
  { id: "minimal-lower-third", label: "Minimal Lower Third", description: "Small lower-third captions (bottom-anchor layout is not yet ported).", presetId: "cinematic-worship", renderable: false, unsupported: ["bottom-anchor-layout"] },
  { id: "tiled-repeat", label: "Tiled Repeat", description: "Repeated tiled text grid (tiled layout is browser-only).", presetId: "hero-bold", renderable: false, unsupported: ["tiled-layout"] },
  { id: "glass-chrome", label: "Glass Chrome", description: "Glass/metal material text (material fills are browser-only).", presetId: "cinematic-worship", renderable: false, unsupported: ["glass-fill", "metal-fill"] },
  { id: "webgl-bloom", label: "WebGL Bloom", description: "WebGL particle bloom scene (GPU/WebGL is browser-only).", presetId: "cinematic-reactive", renderable: false, unsupported: ["webgl", "bloom", "particles"] },
  { id: "video-text", label: "Video Text", description: "Video-filled text (video fill is browser-only).", presetId: "hero-bold", renderable: false, unsupported: ["video-fill"] },
]);

const DEFAULT_TYPOGRAPHY = TYPOGRAPHY_PRESETS["cinematic-default"];

/**
 * Resolve a preset name to a concrete style object. Unknown / missing names
 * fall back to `cinematic-default` so callers never crash on a typo.
 *
 * @param {string | null | undefined} name
 */
export function resolveTypographyPreset(name) {
  if (!name) return DEFAULT_TYPOGRAPHY;
  const key = String(name).trim().toLowerCase();
  return TYPOGRAPHY_PRESETS[key] || DEFAULT_TYPOGRAPHY;
}

export function listTypographyPresets() {
  return Object.keys(TYPOGRAPHY_PRESETS);
}

// ── Layout variety ────────────────────────────────────────────────────────
// Position presets for vertical social video. Bottom layouts sit in a safe
// band (~74% height) so text clears the TikTok/Reels caption + UI strip;
// horizontal anchors stay within the 8–92% safe margins. "center" reproduces
// the historical output byte-for-byte. ffmpeg drawtext expressions reference
// w/h/text_w/text_h (evaluated per frame).
const SAFE_BAND_Y = 0.74; // vertical centre of the lower safe band
const STAGGER_BAND_Y = 0.70; // staggered sits slightly higher for variety
const LAYOUTS = Object.freeze(["center", "center-large", "bottom-center", "bottom-left", "staggered"]);

export function listLayouts() {
  return LAYOUTS.slice();
}

export function resolveLayout(name) {
  const key = String(name ?? "").trim().toLowerCase();
  return LAYOUTS.includes(key) ? key : "center";
}

// Depth / layered text. When enabled, each word also draws a darker, offset
// "ghost" copy BEHIND it — the layered, premium look from the reference clips.
// `depth` may be `true` (defaults) or `{ dx, dy, color, opacity }` (px + colour
// overrides). Falsy → no ghost. dx/dy default to ~1% w / ~1.2% h at render time.
function resolveDepth(depth) {
  if (!depth) return null;
  if (depth === true) return { color: "black", opacity: 0.5 };
  if (typeof depth === "object") {
    return {
      dx: Number.isFinite(depth.dx) ? depth.dx : undefined,
      dy: Number.isFinite(depth.dy) ? depth.dy : undefined,
      color: depth.color || "black",
      opacity: Number.isFinite(depth.opacity) ? depth.opacity : 0.5,
    };
  }
  return null;
}

/**
 * Resolve a layout (+ the word's micro-phrase index for staggering) into the
 * ffmpeg x expression, the y baseline expression, and a size multiplier.
 *
 * @returns {{ xExpr: string, yBase: string, sizeBoost: number }}
 */
function layoutGeometry(layout, phraseIndex = 0) {
  switch (layout) {
    case "center-large":
      return { xExpr: "(w-text_w)/2", yBase: "(h-text_h)/2", sizeBoost: 1.25 };
    case "bottom-center":
      return { xExpr: "(w-text_w)/2", yBase: `(h*${SAFE_BAND_Y}-text_h/2)`, sizeBoost: 1 };
    case "bottom-left":
      return { xExpr: "w*0.08", yBase: `(h*${SAFE_BAND_Y}-text_h/2)`, sizeBoost: 1 };
    case "staggered": {
      const anchors = ["w*0.10", "(w-text_w)/2", "w*0.90-text_w"];
      return { xExpr: anchors[((phraseIndex % 3) + 3) % 3], yBase: `(h*${STAGGER_BAND_Y}-text_h/2)`, sizeBoost: 1 };
    }
    case "center":
    default:
      // Keep the exact historical strings so existing output is unchanged.
      return { xExpr: "(w-text_w)/2", yBase: "(h-text_h)/2", sizeBoost: 1 };
  }
}

/**
 * The ported lumina-presenter design-animation catalog. Each entry carries a
 * `renderable` flag and `unsupported[]` effects, plus a `presetId` that always
 * resolves via resolveTypographyPreset (non-renderable picks degrade to a close
 * style). UI surfaces (Voice Lab / builder) list these; the render pipeline
 * passes `presetId` to buildWordDrawtext.
 */
export function listKineticAnimations() {
  return KINETIC_ANIMATIONS;
}

/**
 * @param {string | null | undefined} id
 * @returns {(typeof KINETIC_ANIMATIONS)[number] | null}
 */
export function resolveKineticAnimation(id) {
  if (!id) return null;
  const key = String(id).trim().toLowerCase();
  return KINETIC_ANIMATIONS.find((a) => a.id === key) || null;
}

export function escapeDrawText(s) {
  // ffmpeg's drawtext `text='...'` form CANNOT contain an ASCII apostrophe
  // (`'`) — even backslash-escaped (`\'`) inside the single-quoted string
  // breaks the chain lexer's quote tracking, which then mis-parses every
  // downstream filter ("No such filter: '<float>'" mid-chain). Real-world
  // Bible text (`John's`, `can't`) hits this constantly. Normalizing to
  // U+2019 RIGHT SINGLE QUOTATION MARK gives visually identical output
  // and sidesteps the lexer entirely. Same treatment for double-quote.
  return String(s || "")
    .replace(/'/g, "’")
    .replace(/"/g, "”")
    .replace(/\n/g, " ")
    .replace(/[:\\\[\]]/g, "\\$&");
}

/**
 * Build a `drawtext=...,drawtext=...` chain that shows one word at a time,
 * each gated by `enable='between(t,start,end)'`. Emphasized words render
 * larger and in amber.
 *
 * @param {{ words: Array<{ text: string, start: number, end: number, emphasize?: boolean }>, w: number, h: number }} opts
 * @returns {string | null}
 */
export function buildWordDrawtext({ words, w, h, preset, layout, depth }) {
  if (!Array.isArray(words) || words.length === 0) return null;
  const style = resolveTypographyPreset(preset);
  // layout arg wins, else the preset may declare one, else "center".
  const resolvedLayout = resolveLayout(layout ?? style.layout);
  // depth arg wins (incl. explicit false), else the preset may declare one.
  const depthCfg = resolveDepth(depth ?? style.depth);
  const depthDx = depthCfg ? (Number.isFinite(depthCfg.dx) ? depthCfg.dx : Math.round(w * 0.010)) : 0;
  const depthDy = depthCfg ? (Number.isFinite(depthCfg.dy) ? depthCfg.dy : Math.round(h * 0.012)) : 0;
  const depthColor = depthCfg?.color || "black";
  const depthOpacity = depthCfg && Number.isFinite(depthCfg.opacity) ? depthCfg.opacity : 0.5;
  const baseSize = Math.max(48, Math.round(h * style.baseSizeMult));
  const emphSize = Math.max(baseSize, Math.round(h * style.emphasisSizeMult));
  // Third "hero" tier — the single biggest word per phrase. Presets that omit
  // heroSizeMult/heroColor fall back to 1.25× the emphasis size and the
  // emphasis colour, so existing presets keep identical key/normal output.
  const heroMult = Number.isFinite(style.heroSizeMult)
    ? style.heroSizeMult
    : style.emphasisSizeMult * 1.25;
  const heroSize = Math.max(emphSize, Math.round(h * heroMult));
  // Default-font glyphs occupy ~0.55× their fontsize in width on average.
  // Clamp per-word so the longest token never overflows 85% of frame width.
  const maxWidthPx = w * 0.85;
  const baseColor = style.baseColor || BASE_TEXT_COLOR;
  const emphasisColor = style.emphasisColor || EMPHASIS_COLOR;
  const heroColor = style.heroColor || emphasisColor;
  const borderWidth = Number.isFinite(style.borderWidth) ? style.borderWidth : 5;
  // Box colour comes from the preset. It used to be hardcoded black@0.35, so a
  // preset could ask for a highlighter block and still get a grey panel - the
  // marker style is defined by that colour, not by having a box at all.
  const boxCol = style.boxColor || "black";
  const boxOp = Number.isFinite(style.boxOpacity) ? style.boxOpacity : 0.35;
  const boxPad = Number.isFinite(style.boxBorderW) ? style.boxBorderW : 12;
  const wordBox = style.wordBox
    ? `:box=1:boxcolor=${boxCol}@${boxOp.toFixed(2)}:boxborderw=${boxPad}`
    : "";

  // Motion model ported from lumina: per-word reveal animation synced to the
  // word's real start time. Legacy presets omit wordReveal → hard-cut (no alpha).
  // Commas inside the clip()/between() expressions are safe because the value is
  // single-quoted (same as the existing enable='between(...)').
  const wordReveal = style.wordReveal; // "fade" | "rise-fade" | "scale-fade" | undefined
  const revealMs = Number.isFinite(style.wordRevealMs) ? style.wordRevealMs : 0;
  const uppercase = Boolean(style.uppercase);
  const shadow = style.shadow;
  const shadowClause = shadow
    ? `:shadowcolor=${shadow.color}:shadowx=${shadow.x ?? 0}:shadowy=${shadow.y ?? 0}`
    : "";
  const riseOffset = Math.round(h * 0.045);

  const filters = [];
  for (const word of words) {
    const rawText = uppercase ? String(word.text ?? "").toUpperCase() : word.text;
    const text = escapeDrawText(rawText);
    if (!text) continue;
    const start = Number(word.start);
    const end = Number(word.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    // 3-tier emphasis. `level` ("hero"|"key"|"normal") is preferred; the legacy
    // `emphasize` boolean (no level) maps to the key tier for back-compat.
    const tier =
      word.level === "hero" ? "hero"
        : word.level === "key" || word.emphasize ? "key"
        : "normal";
    // Per-word geometry from the resolved layout (+ phrase index for stagger).
    const { xExpr, yBase, sizeBoost } = layoutGeometry(resolvedLayout, word.phraseIndex | 0);
    const tierSize = tier === "hero" ? heroSize : tier === "key" ? emphSize : baseSize;
    const requested = Math.round(tierSize * sizeBoost);
    const fitSize = Math.floor(maxWidthPx / Math.max(1, text.length) / 0.55);
    const size = Math.max(40, Math.min(requested, fitSize));
    const color = tier === "hero" ? heroColor : tier === "key" ? emphasisColor : baseColor;

    // Reveal easing: clamp the ease so it always completes inside the word's
    // visible window (a long preset reveal on a short word would otherwise
    // never reach full opacity). scale-fade falls back to fade (drawtext can't
    // animate fontsize). The rise animates around the layout's y baseline.
    let alphaClause = "";
    let ease = "";
    if (wordReveal && revealMs > 0) {
      const reveal = Math.min(revealMs / 1000, (end - start) * 0.9);
      if (reveal > 0) {
        const s = start.toFixed(3);
        const r = reveal.toFixed(3);
        ease = `clip((t-${s})/${r},0,1)`;
        alphaClause = `:alpha='${ease}'`;
      }
    }
    // Build a y-clause for a given baseline; rise-fade lifts it toward the
    // baseline as the word reveals (shared by the main word and its ghost).
    const riseActive = wordReveal === "rise-fade" && ease;
    const yClauseFor = (yb) => (riseActive ? `y='${yb}+${riseOffset}*(1-${ease})'` : `y=${yb}`);
    const enableClause = `:enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'`;

    // Layered "depth" ghost — a darker, offset copy drawn BEFORE (behind) the
    // main word. No border/box/shadow; shares the reveal ease so both animate.
    if (depthCfg) {
      const depthYBase = `(${yBase}+${depthDy})`;
      filters.push(
        `drawtext=text='${text}':x=${xExpr}+${depthDx}:${yClauseFor(depthYBase)}${fontArg(style)}:fontsize=${size}:fontcolor=${depthColor}@${depthOpacity}:borderw=0${alphaClause}${enableClause}`
      );
    }

    filters.push(
      `drawtext=text='${text}':x=${xExpr}:${yClauseFor(yBase)}${fontArg(style)}:fontsize=${size}:fontcolor=${color}:borderw=${borderWidth}:bordercolor=black@0.85${shadowClause}${wordBox}${alphaClause}${enableClause}`
    );
  }
  if (filters.length === 0) return null;
  return filters.join(",");
}

/**
 * Build a sliding-stack `drawtext=...,drawtext=...` chain for legacy line
 * captions (no per-word timing). Mirrors the original renderVideoCore
 * behaviour so the same helper can drive either path.
 *
 * @param {{ lines: string[], w: number, h: number }} opts
 * @returns {string | null}
 */
// Line-fitting constants. MONO_ADVANCE_EM is the per-glyph advance of
// ffmpeg's default monospace face; LINE_WIDTH_BUDGET leaves a margin so text
// never touches the frame edge (soft-glow previously did, with zero room).
const MONO_ADVANCE_EM = 0.6;
const LINE_WIDTH_BUDGET = 0.72;
const MIN_LINE_FONT_SIZE = 22;

// Target width for a wrapped block line. Short lines are what let paced
// captions render large: the frame-width budget caps a 49-char line at ~32px
// but allows ~99px at 16 chars.
const BLOCK_MAX_CHARS = 16;

// How far apart staggered rows arrive, before the per-block cap.
const STAGGER_STEP_SECONDS = 0.28;

/** Greedy word wrap to a character budget. Never splits a word. */
function wrapToBlock(text, maxChars) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const rows = [];
  let cur = "";
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (next.length <= maxChars || !cur) cur = next;
    else { rows.push(cur); cur = word; }
  }
  if (cur) rows.push(cur);
  return rows.length > 0 ? rows : [String(text)];
}

/**
 * Cap a line font size so the LONGEST line still fits the frame width.
 *
 * `lineSizeMult` is multiplied by frame HEIGHT, but the text runs across the
 * frame WIDTH - so a fixed multiplier silently shears long lines off both
 * edges. That is not theoretical: at 0.034 the headline preset rendered
 * "d is close to the brokenheart" on a 1080px frame, and the stock
 * cinematic-default preset draws a 60-character line to ~2306px. Filter
 * strings look correct in every one of those cases; only the pixels show it.
 *
 * Captions use ffmpeg's default monospace face (no preset sets `fontfile`), so
 * glyph advance is a dependable ~0.6em and the fit is computable without
 * measuring. This only ever shrinks: a short line keeps its preset size.
 */
export function fitLineFontSize(lines, w, preferred) {
  const longest = lines.reduce((n, t) => Math.max(n, String(t).length), 0);
  if (longest === 0) return Math.max(MIN_LINE_FONT_SIZE, preferred);
  const budget = w * LINE_WIDTH_BUDGET;
  const maxSize = Math.floor(budget / (longest * MONO_ADVANCE_EM));
  return Math.max(MIN_LINE_FONT_SIZE, Math.min(preferred, maxSize));
}

export function buildLineDrawtext({ lines, w, h, preset, duration, block, reveal, highlightWords, stagger }) {
  const safeLines = Array.isArray(lines) ? lines.filter(Boolean) : [];
  if (safeLines.length === 0) return null;
  const style = resolveTypographyPreset(preset);
  const lineGap = Math.round(h * 0.06);
  const fontSize = fitLineFontSize(safeLines, w, Math.round(h * (style.lineSizeMult || 0.033)));
  const boxOpacity = Number.isFinite(style.lineBoxOpacity) ? style.lineBoxOpacity : 0.35;
  const color = style.baseColor || BASE_TEXT_COLOR;
  const lineBoxCol = style.lineBoxColor || style.boxColor || "black";

  // PACED mode. Given a video duration, split it evenly across the lines and
  // show one at a time, all at the same y. Without this every line drew for
  // the whole video, stacked down the frame - a whole script on screen at
  // once, running off the bottom. Word mode has always been timed; line mode
  // was not, which is why picking a style and getting a wall of text looked
  // identical to the static "preview mode" captions.
  const total = Number(duration);

  // REVEAL mode: true line-by-line. Wrap first, then show ONE row at a time.
  // Revealing raw sentences would be unreadable - a 51-character line caps at
  // 31px on a 1080 frame because the width budget binds - whereas a wrapped
  // row holds ~99px, the same size as a block.
  if (reveal && Number.isFinite(Number(duration)) && Number(duration) > 0) {
    const total = Number(duration);
    const rows = safeLines.flatMap((t) => wrapToBlock(String(t), BLOCK_MAX_CHARS));
    const fontSize = fitLineFontSize(rows, w, Math.round(h * (style.baseSizeMult || 0.07)));
    const slot = total / rows.length;
    const y = Math.round(h * 0.45);
    const parts = [];
    rows.forEach((row, i) => {
      const from = i * slot;
      const to = i === rows.length - 1 ? total : (i + 1) * slot;
      const enable = `:enable='between(t,${from.toFixed(3)},${to.toFixed(3)})'`;
      parts.push(`drawtext=text='${escapeDrawText(row)}':x=(w-text_w)/2:y=${y}${fontArg(style)}:fontsize=${fontSize}:fontcolor=${color}:box=1:boxcolor=${lineBoxCol}@${boxOpacity.toFixed(2)}:boxborderw=18${enable}`);

      // Karaoke overlay: keep the whole row on screen and re-draw just the
      // spoken word in the emphasis colour on top of it. Only the words that
      // belong to THIS row are considered, and only while the row is showing,
      // so a word never lights up over a line it is not part of.
      if (Array.isArray(highlightWords) && highlightWords.length > 0) {
        const emph = style.emphasisColor || style.heroColor || color;
        for (const wd of highlightWords) {
          const text = String(wd?.text || "").trim();
          if (!text || !row.includes(text)) continue;
          const ws = Number(wd.start);
          const we = Number(wd.end);
          if (!Number.isFinite(ws) || !Number.isFinite(we) || we <= ws) continue;
          // Clip the word's window to the row's own window.
          const a = Math.max(ws, from);
          const b = Math.min(we, to);
          if (b <= a) continue;
          // Offset the word to its position within the row, measured in the
          // monospace advance the fit already assumes.
          const before = row.slice(0, row.indexOf(text));
          const dx = Math.round((before.length - row.length / 2 + text.length / 2) * fontSize * MONO_ADVANCE_EM);
          parts.push(`drawtext=text='${escapeDrawText(text)}':x=(w-text_w)/2+${dx}:y=${y}${fontArg(style)}:fontsize=${fontSize}:fontcolor=${emph}:enable='between(t,${a.toFixed(3)},${b.toFixed(3)})'`);
        }
      }
    });
    return parts.join(",");
  }

  // BLOCK mode: wrap each caption into a short stack shown as one unit. A
  // single 49-character line caps at ~32px on a 1080 frame because the width
  // budget binds; wrapping the same text to ~16 characters reaches ~99px. The
  // reference video shows short phrase blocks, not one long line.
  if (block && Number.isFinite(total) && total > 0) {
    const slot = total / safeLines.length;
    const preferred = Math.round(h * (style.baseSizeMult || 0.07));
    const blocks = safeLines.map((t) => wrapToBlock(String(t), BLOCK_MAX_CHARS));
    // One size for every block, so type does not jump between phrases.
    const widest = blocks.flat();
    const fontSize = fitLineFontSize(widest, w, preferred);
    const lead = Math.round(fontSize * 1.25);
    return blocks.map((rows, bi) => {
      const from = bi * slot;
      const to = bi === blocks.length - 1 ? total : (bi + 1) * slot;
      const enable = `:enable='between(t,${from.toFixed(3)},${to.toFixed(3)})'`;
      // Centre the stack on the frame's middle band rather than hanging it
      // from a fixed top, or a tall block runs off the bottom.
      const top = Math.round(h * 0.5 - (rows.length * lead) / 2);
      // STAGGER: rows arrive a beat apart instead of popping in together.
      // The step is capped to a fraction of the block so the LAST row still
      // has time on screen - without the cap a short block would stagger past
      // its own window and that row would never appear.
      const step = stagger
        ? Math.min(STAGGER_STEP_SECONDS, ((to - from) * 0.5) / Math.max(1, rows.length))
        : 0;
      return rows.map((row, ri) => {
        const y = top + ri * lead;
        const rowFrom = from + ri * step;
        const rowEnable = step > 0
          ? `:enable='between(t,${rowFrom.toFixed(3)},${to.toFixed(3)})'`
          : enable;
        return `drawtext=text='${escapeDrawText(row)}':x=(w-text_w)/2:y=${y}${fontArg(style)}:fontsize=${fontSize}:fontcolor=${color}:box=1:boxcolor=${lineBoxCol}@${boxOpacity.toFixed(2)}:boxborderw=18${rowEnable}`;
      }).join(",");
    }).join(",");
  }

  if (Number.isFinite(total) && total > 0) {
    const slot = total / safeLines.length;
    const y = Math.round(h * 0.42);
    // A paced line has the frame to itself, so it gets the preset's WORD size
    // rather than the much smaller stacked-block size. lineSizeMult exists to
    // fit several lines at once; using it here rendered captions a third the
    // size of kinetic text and illegible over a bright sky. fitLineFontSize
    // still caps it to the frame width, so long lines shrink as needed.
    const pacedSize = fitLineFontSize(safeLines, w, Math.round(h * (style.baseSizeMult || 0.07)));
    return safeLines.map((t, i) => {
      const from = i * slot;
      // End the last line exactly on `duration` so rounding cannot leave a
      // silent gap of uncaptioned video at the tail.
      const to = i === safeLines.length - 1 ? total : (i + 1) * slot;
      const enable = `:enable='between(t,${from.toFixed(3)},${to.toFixed(3)})'`;
      return `drawtext=text='${escapeDrawText(t)}':x=(w-text_w)/2:y=${y}${fontArg(style)}:fontsize=${pacedSize}:fontcolor=${color}:box=1:boxcolor=${lineBoxCol}@${boxOpacity.toFixed(2)}:boxborderw=18${enable}`;
    }).join(",");
  }

  // Unpaced (legacy) mode: callers that pass no duration keep the stacked
  // block they already render, rather than getting invented timings.
  const startY = Math.round(h * 0.22);
  return safeLines.map((t, i) => {
    const y = startY + i * lineGap;
    const escaped = escapeDrawText(t);
    // Same reasoning as the word box: honour the preset's colour so a marker
    // line keeps its highlighter block instead of reverting to a black panel.
    return `drawtext=text='${escaped}':x=(w-text_w)/2:y=${y}${fontArg(style)}:fontsize=${fontSize}:fontcolor=${color}:box=1:boxcolor=${lineBoxCol}@${boxOpacity.toFixed(2)}:boxborderw=18`;
  }).join(",");
}

/**
 * Caption MOTION: how captions are timed, independent of how they LOOK.
 *
 * Base modes are mutually exclusive - a caption cannot be per-word and a line
 * block at once - while highlight and stagger are modifiers that layer on top.
 * The picker and the renderer both read this list, so a mode can never appear
 * in the UI that the renderer cannot draw.
 */
const CAPTION_MOTIONS = Object.freeze([
  { id: "words", label: "Per word", description: "One word at a time, synced to the voice." },
  { id: "lines", label: "Per line", description: "One line at a time, full size." },
  { id: "block", label: "Line block", description: "A short phrase on screen together." },
]);

export function listCaptionMotions() {
  return CAPTION_MOTIONS;
}

/**
 * Turn a motion id + modifiers into the flags the builders take.
 *
 * @param {string} [motion] one of CAPTION_MOTIONS ids
 * @param {{stagger?: boolean, highlight?: boolean}} [mods]
 * @param {object} [style] resolved preset, used only when no motion is given
 */
export function resolveCaptionMotion(motion, mods = {}, style = null) {
  const known = CAPTION_MOTIONS.some((m) => m.id === motion);
  // No explicit motion: fall back to what the STYLE asks for, so renders made
  // before this control existed keep behaving exactly as they did.
  const id = known ? motion : (style?.captionMode === "lines" ? "block" : "words");
  return {
    id,
    useWords: id === "words",
    block: id === "block",
    reveal: id === "lines",
    stagger: Boolean(mods.stagger),
    highlight: Boolean(mods.highlight),
  };
}

/**
 * Build the multi-scene video filter graph. Each scene is its own ffmpeg
 * input (looped to ensure it never runs short) and crossfaded into the
 * previous chain output via `xfade`.
 *
 * Returns:
 *   - inputs: list of { path } for the ffmpeg input list (in order)
 *   - filterParts: filter-complex chunks to append (joined with `;` by caller)
 *   - videoLabel: name of the final video stream (`xfinal` or `v0`)
 *   - totalDuration: number of seconds the composed video lasts
 *
 * @param {{ scenes: Array<{ backgroundPath: string, duration: number }>, w: number, h: number, xfadeDuration?: number, kenBurns?: boolean }} opts
 */
export function buildSceneGraph({ scenes, w, h, xfadeDuration, kenBurns }) {
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error("buildSceneGraph: scenes[] required");
  }
  const X = Number.isFinite(xfadeDuration) ? Number(xfadeDuration) : DEFAULT_XFADE_SECONDS;
  const inputs = scenes.map((s) => ({ path: s.backgroundPath, loop: true }));
  const filterParts = [];

  // Each scene is normalized to 30fps + yuv420p + a shared timebase before
  // xfade — clips can come from sources with different framerates/timebases,
  // and xfade refuses to mix mismatched inputs.
  for (let i = 0; i < scenes.length; i++) {
    const dur = Math.max(0.5, Number(scenes[i].duration) || 0);
    const isImage = /\.(jpg|jpeg|png|webp)$/i.test(String(scenes[i].backgroundPath || ""));
    if (kenBurns && isImage) {
      // Ken Burns: zoompan emits d frames PER input frame, so feed it exactly
      // one frame (trim=end_frame=1). Upscale (fill-crop, no distortion) so the
      // slow zoom has pixels to sample, then settle to WxH for xfade.
      const frames = Math.max(1, Math.round(dur * 30));
      filterParts.push(
        `[${i}:v]trim=end_frame=1,setpts=PTS-STARTPTS,scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,crop=${w * 2}:${h * 2},zoompan=z='min(zoom+0.0006,1.06)':d=${frames}:s=${w}x${h}:fps=30,format=yuv420p,trim=duration=${dur.toFixed(3)},setpts=PTS-STARTPTS,settb=AVTB[v${i}]`
      );
    } else {
      filterParts.push(
        `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=30,format=yuv420p,trim=duration=${dur.toFixed(3)},setpts=PTS-STARTPTS,settb=AVTB[v${i}]`
      );
    }
  }

  if (scenes.length === 1) {
    return {
      inputs,
      filterParts,
      videoLabel: "v0",
      totalDuration: Math.max(0.5, Number(scenes[0].duration) || 0),
    };
  }

  let prevLabel = "v0";
  let accumulated = Math.max(0.5, Number(scenes[0].duration) || 0);
  for (let i = 1; i < scenes.length; i++) {
    const dur = Math.max(0.5, Number(scenes[i].duration) || 0);
    const offset = Math.max(0, accumulated - X);
    const nextLabel = i === scenes.length - 1 ? "xfinal" : `x${i}`;
    filterParts.push(
      `[${prevLabel}][v${i}]xfade=transition=fade:duration=${X.toFixed(3)}:offset=${offset.toFixed(3)}[${nextLabel}]`
    );
    accumulated = accumulated + dur - X;
    prevLabel = nextLabel;
  }

  return {
    inputs,
    filterParts,
    videoLabel: prevLabel,
    totalDuration: accumulated,
  };
}

/**
 * Compute trailing fade-out windows for a finished render so the audio doesn't
 * cut off sharp and the picture settles to black. Pure/numeric — the caller
 * assembles the actual `afade` / `fade` filter strings (the two render paths
 * use slightly different graph labels). Fades clamp to half the clip length so
 * very short clips still fade cleanly.
 *
 * @param {{ totalDuration: number, audioFadeSec?: number, videoFadeSec?: number }} opts
 * @returns {{ aFade: number, vFade: number, aStart: number, vStart: number }}
 */
export function buildEndingFade({ totalDuration, audioFadeSec = 1.5, videoFadeSec = 0.6 } = {}) {
  const dur = Number(totalDuration);
  if (!Number.isFinite(dur) || dur <= 0.1) {
    return { aFade: 0, vFade: 0, aStart: 0, vStart: 0 };
  }
  const aFade = Math.max(0, Math.min(audioFadeSec, dur * 0.5));
  const vFade = Math.max(0, Math.min(videoFadeSec, dur * 0.5));
  return {
    aFade,
    vFade,
    aStart: Math.max(0, dur - aFade),
    vStart: Math.max(0, dur - vFade),
  };
}
