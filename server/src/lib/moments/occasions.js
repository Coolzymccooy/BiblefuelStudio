/**
 * What a Moment is for. Each occasion picks the defaults that make one tap
 * work (style, Energy, a bundled song) and carries template statements used
 * whenever the AI is unavailable, so a user always gets editable text.
 */
import { STATEMENT_LIMITS, statementLimit, TITLE_MAX, STATEMENT_MAX } from "../motion/director.js";

// The director owns the word limits; re-exporting keeps one source of truth.
export { statementLimit, TITLE_MAX, STATEMENT_MAX };
export const STATEMENT_LIMIT = STATEMENT_LIMITS;
/** Every length any style offers; each style family offers its own subset (lengthsFor in motion/styles.js). */
export const LENGTHS = Object.freeze([15, 30, 60, 90, 120, 180]);
export const DETAIL_MAX = 80;
export const MAX_STATEMENTS = 16;
export const DETAIL_FIELDS = Object.freeze(["name", "milestone", "eventTitle", "date", "venue", "verse"]);

const o = (def) => Object.freeze({ ...def, fields: Object.freeze(def.fields), titles: Object.freeze(def.titles), statements: Object.freeze(def.statements) });

export const OCCASIONS = Object.freeze({
  birthday: o({
    id: "birthday", label: "Birthday", church: false, fields: ["name", "milestone"],
    style: "celebrate", energy: 0.6, song: "library:gospel-fire",
    titles: ["Happy birthday, {name}!", "Happy birthday!"],
    statements: ["Another year of grace", "{milestone} and still rising", "Favour looks good on you", "God's not done with you", "Celebrate!"],
    voicePrompt: "A warm, joyful birthday blessing.",
  }),
  anniversary: o({
    id: "anniversary", label: "Anniversary", church: false, fields: ["name", "milestone"],
    style: "glow", energy: 0.4, song: "library:hopeful",
    titles: ["Happy anniversary, {name}", "Happy anniversary"],
    statements: ["{milestone} of love", "Still choosing each other", "What God joined together", "Here's to forever"],
    voicePrompt: "A tender anniversary blessing for a couple.",
  }),
  wedding: o({
    id: "wedding", label: "Wedding", church: true, fields: ["name", "date", "venue", "verse"],
    style: "glow", energy: 0.5, song: "library:inspiring-cinematic",
    titles: ["{name}", "Just married"],
    statements: ["Two hearts, one covenant", "Love is patient, love is kind", "{date}", "The best is yet to come"],
    voicePrompt: "A joyful wedding blessing.",
  }),
  sermon: o({
    id: "sermon", label: "Sermon / service promo", church: true, fields: ["eventTitle", "date", "venue", "verse"],
    style: "gallery", energy: 0.5, song: "library:cinematic-inspirational",
    titles: ["{eventTitle}", "Join us for worship"],
    statements: ["This Sunday", "{date}", "{venue}", "Come expectant", "Bring someone"],
    voicePrompt: "An inviting promo for a church service.",
  }),
  event: o({
    id: "event", label: "Church event", church: true, fields: ["eventTitle", "date", "venue", "verse"],
    style: "gallery", energy: 0.6, song: "library:epic-anthem",
    titles: ["{eventTitle}", "You're invited"],
    statements: ["Save the date", "{date}", "{venue}", "Don't miss it", "Come and celebrate with us"],
    voicePrompt: "An exciting invitation to a church event.",
  }),
  thanksgiving: o({
    id: "thanksgiving", label: "Thanksgiving", church: true, fields: ["name", "verse"],
    style: "celebrate", energy: 0.6, song: "library:gospel-praise",
    titles: ["Thank you, Lord", "Thanksgiving"],
    statements: ["Grateful for {name}", "His mercies are new", "Give thanks with a grateful heart", "Glory to God"],
    voicePrompt: "A heartfelt thanksgiving to God.",
  }),
  memorial: o({
    id: "memorial", label: "Memorial", church: true, fields: ["name", "date", "verse"],
    style: "glow", energy: 0.15, song: "library:prayer-piano",
    titles: ["In loving memory of {name}", "In loving memory"],
    statements: ["Forever in our hearts", "A life well lived", "Present with the Lord", "Rest in perfect peace"],
    voicePrompt: "A gentle, comforting tribute in memory of a loved one.",
  }),
  fun: o({
    id: "fun", label: "Just for fun", church: false, fields: ["name"],
    style: "hype", energy: 0.85, song: "library:gospel-revival",
    titles: ["{name}", "Blessed"],
    statements: ["Good vibes only", "Blessed and grateful", "Living the moment", "Let's go!"],
    voicePrompt: "A fun, upbeat faith-filled shout-out.",
  }),
});

export const OCCASION_IDS = Object.freeze(Object.keys(OCCASIONS));

export function resolveOccasion(id) {
  return typeof id === "string" && Object.hasOwn(OCCASIONS, id) ? OCCASIONS[id] : null;
}

/** A template with every {field} filled, or null when one is missing. Too long for `max` is null too. */
function fill(template, details, max) {
  let missing = false;
  const text = template.replace(/\{(\w+)\}/g, (_, key) => {
    const v = String(details?.[key] ?? "").trim();
    if (!v) missing = true;
    return v;
  }).trim();
  return missing || !text || text.length > max ? null : text;
}

export function templatesFor(occasionId, details = {}, lengthSec = 15) {
  const occ = resolveOccasion(occasionId) || OCCASIONS.fun;
  const title = occ.titles.map((t) => fill(t, details, TITLE_MAX)).find(Boolean) || occ.label.slice(0, TITLE_MAX);
  const statements = occ.statements
    .map((s) => fill(s, details, STATEMENT_MAX))
    .filter(Boolean)
    .slice(0, statementLimit(lengthSec));
  return { title, statements: statements.length ? statements : [occ.label.slice(0, STATEMENT_MAX)] };
}
