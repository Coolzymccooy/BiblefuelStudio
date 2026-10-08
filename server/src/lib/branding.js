import fs from "fs";
import path from "path";

/**
 * Per-account branding: a logo drawn in the corner of every video rendered.
 *
 * Layout: <dataDir>/branding.json   settings
 *         <dataDir>/branding/logo.png   the logo, already normalised to PNG
 *
 * Every renderer that delivers a video asks brandLogoFor(dataDir) and, when
 * it gets a logo back, adds the logo as one more input and draws it over its
 * final picture with logoOverlay(). Only filters ffmpeg 5.1 (prod) has.
 */

export const LOGO_POSITIONS = Object.freeze(["top-right", "top-left", "bottom-right", "bottom-left"]);
export const LOGO_SIZES = Object.freeze({ small: 0.75, medium: 1, large: 1.3 });

const DEFAULTS = Object.freeze({ enabled: false, position: "top-right", size: "medium", opacity: 0.85 });

const settingsFile = (dataDir) => path.join(dataDir, "branding.json");

/** Where an account's logo lives; the file may not exist. */
export function logoFileFor(dataDir) {
  if (!dataDir) throw new Error("branding: dataDir required");
  return path.join(dataDir, "branding", "logo.png");
}

function clean(raw) {
  const opacity = Number(raw?.opacity);
  return {
    enabled: raw?.enabled === true,
    position: LOGO_POSITIONS.includes(raw?.position) ? raw.position : DEFAULTS.position,
    size: Object.hasOwn(LOGO_SIZES, raw?.size ?? "") ? raw.size : DEFAULTS.size,
    opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0.2, opacity)) : DEFAULTS.opacity,
  };
}

/** The account's branding settings, plus whether a logo has been uploaded. */
export function readBranding(dataDir) {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(settingsFile(dataDir), "utf8"));
  } catch {
    raw = {};
  }
  return { ...clean(raw), hasLogo: fs.existsSync(logoFileFor(dataDir)) };
}

/** Merge `patch` into the account's settings; unknown or bad values fall back to defaults. */
export function writeBranding(dataDir, patch) {
  fs.mkdirSync(dataDir, { recursive: true });
  const { hasLogo, ...current } = readBranding(dataDir);
  const next = clean({ ...current, ...patch });
  fs.writeFileSync(settingsFile(dataDir), JSON.stringify(next, null, 2));
  return { ...next, hasLogo };
}

/**
 * The logo to draw on this account's videos, or null when branding is off,
 * no logo is uploaded, or no account is known (the renderer then draws none).
 */
export function brandLogoFor(dataDir) {
  if (!dataDir) return null;
  try {
    const b = readBranding(dataDir);
    if (!b.enabled || !b.hasLogo) return null;
    return { file: logoFileFor(dataDir), position: b.position, size: b.size, opacity: b.opacity };
  } catch {
    return null;
  }
}

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

/**
 * The square box the logo is fitted into, and its corner margins, for a
 * w x h frame. The box is a share of the frame's SHORTER side, so a tall mark
 * (an S with a drop beneath it) and a wide one both stay discreet: about a
 * tenth of the picture's height on landscape. Vertical video sits the logo
 * lower from the top edge, clear of the Shorts/TikTok status and search icons.
 */
export function logoGeometry(w, h, size = "medium") {
  const W = Number(w);
  const H = Number(h);
  const base = H > W ? 0.12 : 0.1;
  const box = even(Math.min(W, H) * base * (LOGO_SIZES[size] ?? 1));
  return { box, marginX: Math.round(W * 0.03), marginY: Math.round(H * (H > W ? 0.06 : 0.04)) };
}

// ffmpeg reads a filter argument through two layers: the graph parser, then
// the filter's own options. Each layer takes a backslash as "next character
// is literal", so the path is escaped for the options layer (its ':' and
// quotes) and then again for the graph layer (those backslashes, quotes and
// the graph's own separators). A drive colon or an apostrophe in a folder
// name then reaches the movie source intact.
const BACKSLASH = String.fromCharCode(92);
const escapeChars = (s, chars) => [...s].map((c) => (chars.includes(c) ? BACKSLASH + c : c)).join("");
const filterPath = (p) => escapeChars(
  escapeChars(String(p).split(BACKSLASH).join("/"), `':${BACKSLASH}`),
  `'[],;${BACKSLASH}`,
);

/**
 * Filtergraph text that draws `logo` (from brandLogoFor) over the picture
 * labelled `from`, producing `to`.
 *
 * The logo is read inside the graph by the movie source rather than as an
 * extra -i input, so no renderer has to renumber its inputs or keep a new
 * input ahead of its output options. A single image ends after one frame and
 * overlay keeps showing it to the end (eof_action=repeat).
 *
 * In a plain -vf chain pass from/to as null: the chain's own input feeds the
 * overlay and its output is the chain's output.
 */
export function logoOverlay(logo, { w, h, from, to = "vlogo" }) {
  const { box, marginX, marginY } = logoGeometry(w, h, logo.size);
  const right = logo.position.endsWith("right");
  const bottom = logo.position.startsWith("bottom");
  const x = right ? `main_w-overlay_w-${marginX}` : String(marginX);
  const y = bottom ? `main_h-overlay_h-${marginY}` : String(marginY);
  const alpha = Number(logo.opacity).toFixed(2);
  return `movie=${filterPath(logo.file)},scale=${box}:${box}:force_original_aspect_ratio=decrease,format=rgba,colorchannelmixer=aa=${alpha}[brandlogo];`
    + `${from ? `[${from}]` : ""}[brandlogo]overlay=x=${x}:y=${y}${to ? `[${to}]` : ""}`;
}

/**
 * Wrap a -vf chain so it ends with the logo drawn on: "<chain>[brandbase];
 * <logo>". Unchanged when there is no logo.
 */
export function withLogoVf(vf, logo, { w, h }) {
  if (!logo) return vf;
  return `${vf}[brandbase];${logoOverlay(logo, { w, h, from: "brandbase", to: null })}`;
}
