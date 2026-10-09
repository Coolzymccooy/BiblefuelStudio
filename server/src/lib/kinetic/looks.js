/**
 * Studio caption looks: the fonts and colours the kinetic engine draws in.
 * The ids the pickers use are "studio-" + id. `fallbackPreset` is the
 * drawtext preset used where libass is missing.
 */
export const STUDIO_PREFIX = "studio-";

export const LOOKS = Object.freeze({
  "lagos-night": Object.freeze({
    id: "lagos-night",
    label: "Lagos Night",
    description: "Yellow brush hits over white marker lines.",
    body: { file: "PermanentMarker.ttf", family: "Permanent Marker", colour: "#FFFFFF" },
    hit: { file: "Knewave-Regular.ttf", family: "Knewave", colour: "#F5D33A" },
    outline: "#101010",
    uppercase: true,
    fallbackPreset: "marker",
  }),
  "gospel-gold": Object.freeze({
    id: "gospel-gold",
    label: "Gospel Gold",
    description: "Gold headline hits over cream serif lines.",
    body: { file: "PlayfairDisplay-BoldItalic.ttf", family: "Playfair Display", colour: "#F4EBD0" },
    hit: { file: "Anton.ttf", family: "Anton", colour: "#E8B04B" },
    outline: "#1A1208",
    uppercase: false,
    fallbackPreset: "scripture-emphasis",
  }),
  "clean-white": Object.freeze({
    id: "clean-white",
    label: "Clean White",
    description: "White marker throughout, bold white hits.",
    body: { file: "PermanentMarker.ttf", family: "Permanent Marker", colour: "#FFFFFF" },
    hit: { file: "Anton.ttf", family: "Anton", colour: "#FFFFFF" },
    outline: "#000000",
    uppercase: true,
    fallbackPreset: "hero-bold",
  }),
});

/** Used for a phrase whose letters a look's fonts cannot draw (ẹ, ọ, ṣ …). */
export const FALLBACK_FONT = Object.freeze({ file: "DejaVuSans.ttf", family: "DejaVu Sans" });

export const ENERGIES = Object.freeze([
  { id: "calm", label: "Calm", description: "Words pop in and stack. Best for sermons and readings." },
  { id: "lively", label: "Lively", description: "Adds big brush slams on the lines that repeat." },
  { id: "wild", label: "Wild", description: "Slams everywhere. Made for songs." },
]);

export function isStudioLook(id) {
  return typeof id === "string" && id.startsWith(STUDIO_PREFIX) && Boolean(LOOKS[id.slice(STUDIO_PREFIX.length)]);
}

export function resolveLook(id) {
  const key = String(id || "").startsWith(STUDIO_PREFIX) ? String(id).slice(STUDIO_PREFIX.length) : String(id || "");
  return LOOKS[key] || LOOKS["clean-white"];
}

export function resolveEnergy(id, fallback = "lively") {
  return ENERGIES.some((e) => e.id === id) ? id : fallback;
}

export function listStudioLooks() {
  return Object.values(LOOKS).map((l) => ({ id: STUDIO_PREFIX + l.id, label: l.label, description: l.description }));
}
