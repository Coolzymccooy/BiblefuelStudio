import { cartoonFromScript, isReservedName } from "./model.js";
import { parseCartoonScript } from "./parse.js";
import { checkFilm, MAX_FILM_SEC, MAX_SHOTS } from "./plan.js";
import { styleId, isStyleName } from "./styles.js";
import { isBedRef } from "../sceneScript/music.js";

/**
 * The rules the cartoon router applies when a project is edited (spec section
 * 7, Task 12). Pure: every function takes a project and returns a new one, so
 * the router can run them inside the store's read-change-write step.
 *
 * What an edit invalidates:
 *  - a changed look drops that character's portrait and approval (the picture
 *    shows the old look);
 *  - a changed style keeps the portraits but un-approves them all (they were
 *    drawn in the old style);
 *  - any change to shots, looks, style or the script needs the shot list
 *    approved again.
 *
 * Cast names come from users, so they are looked up by own property only and
 * names that would reach Object.prototype are refused.
 */

export const MAX_TITLE_CHARS = 120;
export const MAX_LOOK_CHARS = 600;
export const MAX_VOICE_CHARS = 200;
export const MAX_NOTE_CHARS = 300;
export const MAX_END_CARD_CHARS = 200;

const FIRST_FRAMES = new Set(["fresh", "chain"]);

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);
const isObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** A cast name that is safe to use as an object key. */
export function isPlainName(name) {
  return typeof name === "string" && name !== "" && !isReservedName(name);
}

/** A cast member by own property only, never through the prototype chain. */
export function ownMember(project, name) {
  const cast = project?.cast;
  if (!cast || !isPlainName(name) || !Object.hasOwn(cast, name)) return null;
  return cast[name];
}

/** "Eli", "Eli and Pip", "Eli, Pip and Naomi". */
export function listNames(names) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** A character is ready to film once a finished portrait of them is approved. */
export function portraitReady(member) {
  return Boolean(member?.approved && member.portrait?.status === "done" && member.portrait.url);
}

/** Every character in the script (the cast, which includes every speaker) without an approved portrait. */
export function unreadyCast(project) {
  const cast = project?.cast || {};
  const names = new Set(Object.keys(cast));
  for (const shot of project?.shots || []) if (shot.speaker) names.add(shot.speaker);
  return [...names].filter((name) => !portraitReady(ownMember(project, name)));
}

/** Whether a clip was ever ordered for any shot: then the lines are locked. */
export function isLocked(project) {
  return (project?.shots || []).some((s) => Boolean(s.clip && (s.clip.taskId || s.clip.libraryId || s.clip.previous?.taskId)));
}

/** "Fits" (controller ruling 1): within 40 s, at most 8 shots, and no line too long for one clip. */
export function fits(check) {
  return Boolean(check?.ok && !check.tooMany && (check.tooLong || []).length === 0);
}

const secs = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Why a script does not fit, as one sentence. */
export function tooLongSentence(check) {
  if (check?.tooLong?.length) {
    const first = check.tooLong[0];
    return `Shot ${String(first.shotId).replace(/^sh/, "")} has ${first.words} words, too many for one clip. Split the line in two.`;
  }
  if (check?.tooMany) return `A cartoon has at most ${MAX_SHOTS} shots. Remove a line or two.`;
  const scene = check?.trimScene?.place ? ` Trim the scene "${check.trimScene.place}".` : "";
  return `This film runs ${secs(check?.filmSec || 0)} s, ${secs(check?.overBySec || 0)} s over the ${MAX_FILM_SEC} s limit.${scene}`;
}

/** The length check of the project as it is now. */
export function checkOf(project) {
  return checkFilm(project?.shots || [], project?.scenes || []);
}

function mapCast(project, fn) {
  return Object.fromEntries(Object.entries(project.cast || {}).map(([name, member]) => [name, fn(member, name)]));
}

/** A cast member with a new look: the old portrait no longer shows them. */
function withNewLook(member, look) {
  const { styleMismatch: _mismatch, ...rest } = member;
  return { ...rest, look, portrait: null, approved: false, shelfId: null };
}

/** A style that names no real style (by id, label or short name) changes nothing. */
function applyStyle(project, style) {
  if (!isStyleName(style)) return project;
  const id = styleId(style);
  if (id === project.meta?.style) return project;
  const anyPortrait = Object.values(project.cast || {}).some((m) => m?.portrait);
  return {
    ...project,
    meta: { ...project.meta, style: id },
    cast: anyPortrait ? mapCast(project, (m) => ({ ...m, approved: false })) : project.cast,
  };
}

function applyCast(project, edits) {
  if (!isObject(edits)) return project;
  let cast = project.cast;
  for (const name of Object.keys(edits)) {
    const member = ownMember({ cast }, name);
    const edit = edits[name];
    if (!member || !isObject(edit)) continue;
    const look = str(edit.look, MAX_LOOK_CHARS);
    const voice = str(edit.voice, MAX_VOICE_CHARS);
    let next = voice !== undefined ? { ...member, voice } : member;
    if (look !== undefined && look !== (member.look || "")) next = withNewLook(next, look);
    if (next !== member) cast = { ...cast, [name]: next };
  }
  return cast === project.cast ? project : { ...project, cast };
}

function applyShots(project, edits) {
  if (!Array.isArray(edits)) return project;
  const byId = new Map(edits.filter((e) => isObject(e) && typeof e.id === "string").map((e) => [e.id, e]));
  return {
    ...project,
    shots: project.shots.map((s) => {
      const e = byId.get(s.id);
      if (!e) return s;
      const note = str(e.note, MAX_NOTE_CHARS);
      return {
        ...s,
        ...(note !== undefined ? { note } : {}),
        ...(FIRST_FRAMES.has(e.firstFrame) ? { firstFrame: e.firstFrame } : {}),
      };
    }),
  };
}

function applyExtras(project, body) {
  let next = project;
  const title = str(body.title, MAX_TITLE_CHARS);
  if (title) next = { ...next, meta: { ...next.meta, title } };
  if (isObject(body.captions) && typeof body.captions.enabled === "boolean") next = { ...next, captions: { ...next.captions, enabled: body.captions.enabled } };
  if (body.bed === null || isBedRef(body.bed)) next = { ...next, music: { ...next.music, bed: body.bed } };
  if (isObject(body.endCard)) {
    const text = str(body.endCard.text, MAX_END_CARD_CHARS);
    if (text !== undefined) next = { ...next, endCard: { ...next.endCard, text } };
  }
  return next;
}

/** What the shot list approval depends on: the style, each look and each shot's note and first frame. */
function filmShape(project) {
  return JSON.stringify({
    style: project.meta?.style,
    looks: Object.entries(project.cast || {}).map(([name, m]) => [name, m?.look || ""]),
    shots: (project.shots || []).map((s) => [s.id, s.note, s.firstFrame]),
  });
}

/**
 * Apply a PATCH body (title, style, cast, shots, captions, bed, endCard; the
 * script itself goes through `rescript`). Unknown fields are ignored.
 */
export function applyEdit(project, body) {
  const edit = isObject(body) ? body : {};
  const next = applyExtras(applyShots(applyCast(applyStyle(project, edit.style), edit.cast), edit.shots), edit);
  return filmShape(next) === filmShape(project) ? next : { ...next, shotListApproved: false };
}

/** A new script parsed and planned, and whether it names a style of its own. */
export function scriptDraft(markdown, { now } = {}) {
  const { style } = parseCartoonScript(markdown);
  return { fresh: cartoonFromScript(markdown, { now }), hasStyle: typeof style === "string" && style.trim() !== "" };
}

/**
 * The cast of a re-parsed script. A character whose name and look are
 * unchanged keeps its portrait, approval and shelf link. A character the new
 * script gives no look keeps the look it had (one typed in the cast card).
 */
function mergeCast(oldCast, freshCast) {
  return Object.fromEntries(Object.entries(freshCast).map(([name, member]) => {
    const old = isPlainName(name) && Object.hasOwn(oldCast || {}, name) ? oldCast[name] : null;
    if (!old) return [name, member];
    const look = member.look || old.look || "";
    if (look !== (old.look || "")) return [name, { ...member, look }];
    const kept = { portrait: old.portrait ?? null, approved: Boolean(old.approved), shelfId: old.shelfId ?? null };
    if (old.styleMismatch !== undefined) kept.styleMismatch = old.styleMismatch;
    return [name, { ...member, look, voice: member.voice || old.voice || "", ...kept }];
  }));
}

/**
 * The project with a new script (controller ruling 3). The caller has already
 * refused a locked project and a script that does not fit. Seed, pictures,
 * spend, music, captions and end card stay; scenes and shots are new, so the
 * shot list needs approving again.
 */
export function rescript(current, { fresh, hasStyle }, { verseText = "" } = {}) {
  const style = hasStyle ? fresh.meta.style : current.meta?.style || fresh.meta.style;
  const next = {
    ...current,
    meta: {
      ...current.meta,
      title: fresh.meta.title || current.meta?.title || "",
      verse: { reference: fresh.meta.verse.reference, text: verseText },
      style: current.meta?.style,
    },
    source: fresh.source,
    cast: mergeCast(current.cast, fresh.cast),
    scenes: fresh.scenes,
    shots: fresh.shots,
    check: fresh.check,
    warnings: fresh.warnings,
    shotListApproved: false,
  };
  return applyStyle(next, style);
}
