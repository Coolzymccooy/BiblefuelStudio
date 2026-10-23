/**
 * Who reads what. A cast maps each speaker in the script to a voice and its
 * delivery; any line can override its speaker's voice. The ensemble is a
 * stack of voices that read the chant together with small offsets.
 *
 * Voices are Azure Speech names. HD voices ("…:DragonHDLatestNeural") are the
 * most expressive; en-NG voices give a Nigerian English accent.
 */

export const VOICES = Object.freeze([
  { id: "en-US-Davis:DragonHDLatestNeural", label: "Davis (deep, US, HD)", gender: "male", age: "adult" },
  { id: "en-US-Andrew:DragonHDLatestNeural", label: "Andrew (warm, US, HD)", gender: "male", age: "adult" },
  { id: "en-US-Brian:DragonHDLatestNeural", label: "Brian (calm, US, HD)", gender: "male", age: "adult" },
  { id: "en-US-Ava:DragonHDLatestNeural", label: "Ava (gentle, US, HD)", gender: "female", age: "adult" },
  { id: "en-US-Emma:DragonHDLatestNeural", label: "Emma (bright, US, HD)", gender: "female", age: "adult" },
  { id: "en-NG-AbeoNeural", label: "Abeo (Nigerian English)", gender: "male", age: "adult" },
  { id: "en-NG-EzinneNeural", label: "Ezinne (Nigerian English)", gender: "female", age: "adult" },
  { id: "en-GB-RyanNeural", label: "Ryan (British)", gender: "male", age: "adult" },
  { id: "en-GB-SoniaNeural", label: "Sonia (British)", gender: "female", age: "adult" },
  { id: "en-US-AnaNeural", label: "Ana (child, US)", gender: "female", age: "child" },
  { id: "en-GB-MaisieNeural", label: "Maisie (child, British)", gender: "female", age: "child" },
]);

const VOICE_NAME_RE = /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z]+(?::DragonHDLatestNeural|Neural)$/;
const PERCENT_RE = /^[+-]?\d{1,2}%$/;

/** The nine-voice ensemble from the Grace Made Me prototype: adults, Nigerian English and children. */
export const DEFAULT_ENSEMBLE = Object.freeze([
  { voice: "en-US-Davis:DragonHDLatestNeural", pitch: "-4%", offsetMs: 0 },
  { voice: "en-US-Andrew:DragonHDLatestNeural", pitch: "0%", offsetMs: 35 },
  { voice: "en-US-Brian:DragonHDLatestNeural", pitch: "-2%", offsetMs: 70 },
  { voice: "en-NG-AbeoNeural", pitch: "-3%", offsetMs: 20 },
  { voice: "en-US-Ava:DragonHDLatestNeural", pitch: "0%", offsetMs: 50 },
  { voice: "en-US-Emma:DragonHDLatestNeural", pitch: "2%", offsetMs: 15 },
  { voice: "en-NG-EzinneNeural", pitch: "0%", offsetMs: 60 },
  { voice: "en-US-AnaNeural", pitch: "0%", offsetMs: 40 },
  { voice: "en-GB-MaisieNeural", pitch: "0%", offsetMs: 80 },
]);

export const ROOM_SIZES = Object.freeze(["small", "hall", "church"]);
export const MAX_ENSEMBLE_LAYERS = 12;

export function isVoiceName(v) {
  return typeof v === "string" && VOICE_NAME_RE.test(v);
}

const percent = (v, fallback = "0%") => {
  if (typeof v !== "string" || !PERCENT_RE.test(v)) return fallback;
  const n = Math.max(-50, Math.min(50, parseInt(v, 10)));
  return `${n >= 0 ? "+" : ""}${n}%`.replace(/^\+0%$/, "0%");
};

const childWords = /\b(child|children|kid|boy|girl)\b/i;
const femaleWords = /\b(female|woman|women|girl|mother|she|lady|sister)\b/i;

function guessVoice(name, hint = {}) {
  const words = `${name} ${hint.notes || ""}`;
  if (childWords.test(name)) return "en-US-AnaNeural";
  const female = hint.gender === "female" || (hint.gender !== "male" && femaleWords.test(words));
  return female ? "en-US-Ava:DragonHDLatestNeural" : "en-US-Andrew:DragonHDLatestNeural";
}

function ensembleFromHint(hint = {}) {
  if (hint.children === false && hint.adults !== false) {
    return DEFAULT_ENSEMBLE.filter((l) => VOICES.find((v) => v.id === l.voice)?.age !== "child");
  }
  return DEFAULT_ENSEMBLE;
}

/**
 * The cast a fresh project starts with, from the script's speakers and its
 * voice hints ("a deep male narrator", "a gentle female voice").
 */
export function defaultCast(script) {
  const hints = script?.voiceHints || {};
  const cast = {
    Narrator: {
      voice: hints.Narrator?.gender === "female" ? "en-US-Ava:DragonHDLatestNeural" : "en-US-Davis:DragonHDLatestNeural",
      rate: "-6%", pitch: "0%",
    },
    Scripture: {
      voice: hints.Scripture?.gender === "male" ? "en-US-Andrew:DragonHDLatestNeural" : "en-US-Ava:DragonHDLatestNeural",
      rate: "-8%", pitch: "0%",
    },
    Ensemble: { ensemble: ensembleFromHint(hints.Ensemble).map((l) => ({ ...l })), rate: "-12%", room: "hall" },
  };
  for (const { name } of script?.speakers || []) {
    if (!cast[name]) cast[name] = { voice: guessVoice(name, hints[name]), rate: "0%", pitch: "0%" };
  }
  return cast;
}

function normaliseLayer(layer) {
  if (!isVoiceName(layer?.voice)) return null;
  const offset = Math.round(Number(layer.offsetMs));
  return { voice: layer.voice, pitch: percent(layer.pitch), offsetMs: Number.isFinite(offset) ? Math.max(0, Math.min(400, offset)) : 0 };
}

function normaliseEntry(entry, fallback) {
  if (Array.isArray(entry?.ensemble)) {
    const layers = entry.ensemble.map(normaliseLayer).filter(Boolean).slice(0, MAX_ENSEMBLE_LAYERS);
    return {
      ensemble: layers.length ? layers : fallback.ensemble || DEFAULT_ENSEMBLE.map((l) => ({ ...l })),
      rate: percent(entry.rate, fallback.rate || "-12%"),
      room: ROOM_SIZES.includes(entry.room) ? entry.room : fallback.room || "hall",
    };
  }
  return {
    voice: isVoiceName(entry?.voice) ? entry.voice : fallback.voice,
    rate: percent(entry?.rate, fallback.rate || "0%"),
    pitch: percent(entry?.pitch, fallback.pitch || "0%"),
  };
}

/**
 * Merge an edit into a cast. Unknown speakers are dropped, bad values fall
 * back to what the cast had, and the result is a new object.
 */
export function normaliseCast(input, current) {
  const next = {};
  for (const [name, entry] of Object.entries(current)) {
    const edit = input && typeof input === "object" && Object.hasOwn(input, name) ? input[name] : entry;
    next[name] = normaliseEntry(edit, entry);
  }
  return next;
}

/** One line's delivery: its own override, else its speaker's, else the narrator's. */
export function deliveryForLine(line, cast) {
  const base = cast[line.speaker] || cast.Narrator;
  if (base.ensemble) return { ...base, ensemble: base.ensemble.map((l) => ({ ...l })) };
  const own = line.voice && isVoiceName(line.voice) ? line.voice : base.voice;
  return {
    voice: own,
    rate: percent(line.rate, base.rate),
    pitch: percent(line.pitch, base.pitch),
  };
}
