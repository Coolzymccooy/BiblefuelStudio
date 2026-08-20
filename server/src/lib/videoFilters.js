// FFmpeg filter-graph builders for the new word-level captions and
// scene-splitter pipelines. Pure functions — no fs/spawn/network. Each
// returns plain strings (or arrays of strings) the caller assembles into
// the final ffmpeg invocation.

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
});

// The lumina-presenter design-animation catalog, ported. Browser-only effects
// (particles, WebGL bloom, 3D extrude, metal/glass/video fill, audio-reactive
// pulsing) can't render in ffmpeg drawtext, so each entry declares whether it
// is `renderable` server-side and lists the `unsupported` effects. Every entry
// maps to a real `presetId` so non-renderable picks degrade to a close style
// instead of crashing.
const KINETIC_ANIMATIONS = Object.freeze([
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
  const wordBox = style.wordBox ? ":box=1:boxcolor=black@0.35:boxborderw=12" : "";

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
        `drawtext=text='${text}':x=${xExpr}+${depthDx}:${yClauseFor(depthYBase)}:fontsize=${size}:fontcolor=${depthColor}@${depthOpacity}:borderw=0${alphaClause}${enableClause}`
      );
    }

    filters.push(
      `drawtext=text='${text}':x=${xExpr}:${yClauseFor(yBase)}:fontsize=${size}:fontcolor=${color}:borderw=${borderWidth}:bordercolor=black@0.85${shadowClause}${wordBox}${alphaClause}${enableClause}`
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
export function buildLineDrawtext({ lines, w, h, preset }) {
  const safeLines = Array.isArray(lines) ? lines.filter(Boolean) : [];
  if (safeLines.length === 0) return null;
  const style = resolveTypographyPreset(preset);
  const startY = Math.round(h * 0.22);
  const lineGap = Math.round(h * 0.06);
  const fontSize = Math.max(28, Math.round(h * (style.lineSizeMult || 0.033)));
  const boxOpacity = Number.isFinite(style.lineBoxOpacity) ? style.lineBoxOpacity : 0.35;
  const color = style.baseColor || BASE_TEXT_COLOR;
  return safeLines.map((t, i) => {
    const y = startY + i * lineGap;
    const escaped = escapeDrawText(t);
    return `drawtext=text='${escaped}':x=(w-text_w)/2:y=${y}:fontsize=${fontSize}:fontcolor=${color}:box=1:boxcolor=black@${boxOpacity.toFixed(2)}:boxborderw=18`;
  }).join(",");
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
