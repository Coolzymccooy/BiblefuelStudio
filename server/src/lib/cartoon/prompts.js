import { STYLES, styleId } from "./styles.js";
import { NO_TEXT_LINE } from "../videoGen/providers/seedance.js";

/**
 * Prompt builders for cartoon mode: the character portrait and the Seedance
 * clip. The wording follows what the C0 paid test proved: one speaker per
 * shot, the line quoted byte for byte, an explicit "no one else speaks", no
 * music, and reference pictures named by number so the model ties each face to
 * a name.
 *
 * `referencedCast` decides which approved portraits a fresh shot sends as
 * reference pictures. The film stage uses the same list for the files, so the
 * "reference picture N" sentences and the files can never disagree.
 */

/** Most reference pictures Seedance is sent with one shot. */
export const MAX_REFERENCES = 3;

const NO_MUSIC_LINE = "No background music.";
const PORTRAIT_FRAMING = "Three-quarter view, head and shoulders, plain soft warm background, friendly expression.";

function stylePrompt(id) {
  return STYLES[styleId(id)].prompt;
}

/** Drops trailing full stops and spaces so a look reads cleanly inside a sentence. */
function trimmedLook(look) {
  return typeof look === "string" ? look.trim().replace(/[.\s]+$/, "") : "";
}

/** The prompt for one character's portrait (made once, then sent as a reference picture). */
export function portraitPrompt(character, style) {
  const name = character?.name || "";
  const look = trimmedLook(character?.look);
  const subject = look ? `Character portrait of ${name}, ${look}.` : `Character portrait of ${name}.`;
  return [`${stylePrompt(style)}.`, subject, PORTRAIT_FRAMING, NO_TEXT_LINE].join(" ");
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Where `name` first appears in `text` as a whole word (any case), or -1. */
function wholeWordIndex(text, name) {
  if (!text || !name) return -1;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(name)}(?![\\p{L}\\p{N}_])`, "iu");
  const match = pattern.exec(text);
  return match ? match.index : -1;
}

/** Cast names found in `text`, in the order they appear. */
function namesIn(text, castNames) {
  return castNames
    .map((name, order) => ({ name, order, at: wholeWordIndex(text, name) }))
    .filter((hit) => hit.at >= 0)
    .sort((a, b) => a.at - b.at || a.order - b.order)
    .map((hit) => hit.name);
}

/**
 * Every character in the shot's scene, in order of first appearance: names in
 * the place and note, then each shot of the scene in turn (its speaker, then
 * names in its action text).
 */
function sceneMembers(project, shot) {
  const castNames = Object.keys(project?.cast || {});
  const scene = (project?.scenes || []).find((s) => s.id === shot?.sceneId);
  // The shot being asked about stands in for its stored copy, so an edit not saved yet still counts.
  const stored = project?.shots || [];
  const current = stored.some((s) => s.id === shot?.id) ? stored.map((s) => (s.id === shot.id ? shot : s)) : [...stored, shot];
  const sceneShots = current.filter((s) => s?.sceneId === shot?.sceneId);
  const ordered = [...namesIn(`${scene?.place || ""} ${scene?.note || ""}`, castNames)];
  for (const sceneShot of sceneShots) {
    if (sceneShot.speaker && castNames.includes(sceneShot.speaker)) ordered.push(sceneShot.speaker);
    ordered.push(...namesIn(sceneShot.action || "", castNames));
  }
  return [...new Set(ordered)];
}

/**
 * Names whose portraits a fresh shot sends as reference pictures, in order:
 * the speaker first, then the rest of the scene. Only approved characters with
 * a portrait count, at most three. A chained shot sends none.
 */
export function referencedCast(project, shot) {
  if (!shot || shot.firstFrame !== "fresh") return [];
  const cast = project?.cast || {};
  const usable = (name) => Boolean(cast[name]?.approved && cast[name]?.portrait);
  const speaker = shot.speaker ? [shot.speaker] : [];
  const names = [...new Set([...speaker, ...sceneMembers(project, shot)])];
  return names.filter(usable).slice(0, MAX_REFERENCES);
}

function referenceSentences(project, shot) {
  return referencedCast(project, shot).map((name, index) => `${name} is the character in reference picture ${index + 1}.`);
}

function speechSentences(project, shot) {
  const speaker = shot.speaker;
  const member = project?.cast?.[speaker];
  const look = trimmedLook(member?.look);
  const voice = typeof member?.voice === "string" ? member.voice.trim() : "";
  const sentences = [];
  if (look) sentences.push(`${look}.`);
  sentences.push(`${speaker} speaks${voice ? ` in ${voice}` : ""}, saying: "${shot.line}"`);
  sentences.push(`Only ${speaker} speaks; everyone else stays silent with their mouth closed.`);
  return sentences;
}

/** What the rest of the scene looks like, by look only, never by name. */
function othersSentence(project, shot) {
  const looks = sceneMembers(project, shot)
    .filter((name) => name !== shot.speaker)
    .map((name) => trimmedLook(project.cast[name]?.look))
    .filter(Boolean);
  return looks.length ? `Also in the scene: ${looks.join("; ")}.` : "";
}

/** The prompt for one Seedance clip. */
export function clipPrompt(project, shot) {
  const scene = (project?.scenes || []).find((s) => s.id === shot.sceneId);
  const spoken = shot.speaker && typeof shot.line === "string";
  const action = typeof shot.action === "string" ? shot.action.trim() : "";
  const parts = [
    `${stylePrompt(project?.meta?.style)}.`,
    scene?.place ? `${scene.place.trim().replace(/[.\s]+$/, "")}.` : "",
    shot.note ? `${shot.note.trim().replace(/[.\s]+$/, "")}.` : "",
    ...referenceSentences(project, shot),
    ...(spoken ? speechSentences(project, shot) : ["No one speaks."]),
    action,
    othersSentence(project, shot),
    NO_MUSIC_LINE,
    NO_TEXT_LINE,
  ];
  return parts.filter((part) => part !== "").join(" ");
}
