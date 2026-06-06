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
    borderWidth: 6, wordBox: false, lineBoxOpacity: 0.4, lineSizeMult: 0.04,
    lineEnter: "rise-fade", wordReveal: "rise-fade", wordRevealMs: 300, uppercase: true,
  },
  "music-video": {
    baseSizeMult: 0.08, emphasisSizeMult: 0.098, baseColor: "white", emphasisColor: "#FB7185",
    borderWidth: 5, wordBox: false, lineBoxOpacity: 0.4, lineSizeMult: 0.035,
    lineEnter: "rise-fade", wordReveal: "fade", wordRevealMs: 240, uppercase: false,
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
export function buildWordDrawtext({ words, w, h, preset }) {
  if (!Array.isArray(words) || words.length === 0) return null;
  const style = resolveTypographyPreset(preset);
  const baseSize = Math.max(48, Math.round(h * style.baseSizeMult));
  const emphSize = Math.max(baseSize, Math.round(h * style.emphasisSizeMult));
  // Default-font glyphs occupy ~0.55× their fontsize in width on average.
  // Clamp per-word so the longest token never overflows 85% of frame width.
  const maxWidthPx = w * 0.85;
  const baseColor = style.baseColor || BASE_TEXT_COLOR;
  const emphasisColor = style.emphasisColor || EMPHASIS_COLOR;
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
    const requested = word.emphasize ? emphSize : baseSize;
    const fitSize = Math.floor(maxWidthPx / Math.max(1, text.length) / 0.55);
    const size = Math.max(40, Math.min(requested, fitSize));
    const color = word.emphasize ? emphasisColor : baseColor;

    // Reveal easing: clamp the ease so it always completes inside the word's
    // visible window (a long preset reveal on a short word would otherwise
    // never reach full opacity). scale-fade falls back to fade (drawtext can't
    // animate fontsize).
    let alphaClause = "";
    let yClause = "y=(h-text_h)/2";
    if (wordReveal && revealMs > 0) {
      const reveal = Math.min(revealMs / 1000, (end - start) * 0.9);
      if (reveal > 0) {
        const s = start.toFixed(3);
        const r = reveal.toFixed(3);
        const ease = `clip((t-${s})/${r},0,1)`;
        alphaClause = `:alpha='${ease}'`;
        if (wordReveal === "rise-fade") {
          yClause = `y='(h-text_h)/2+${riseOffset}*(1-${ease})'`;
        }
      }
    }

    filters.push(
      `drawtext=text='${text}':x=(w-text_w)/2:${yClause}:fontsize=${size}:fontcolor=${color}:borderw=${borderWidth}:bordercolor=black@0.85${shadowClause}${wordBox}${alphaClause}:enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'`
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
