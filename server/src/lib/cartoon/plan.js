/**
 * Shot planner and the 40 second rule (spec section 7.6). Turns a parsed
 * cartoon script into a list of shots and checks whether the finished film,
 * with its verse card and end card, fits in 40 seconds.
 *
 * Pure and deterministic. One spoken line is one shot, because two speakers in
 * one Seedance clip fail. A silent action joins the shot before it in the same
 * scene; an action that opens a scene is a short silent shot of its own. A
 * shot's length follows its words (2.5 a second plus a breath), kept inside
 * Seedance's 4 to 12 second range. A line that would need more than 12 seconds
 * is reported in `tooLong` so the editor can ask for it to be split.
 */

export const WORDS_PER_SEC = 2.5;
export const BREATH_SEC = 1;
export const SILENT_SHOT_SEC = 4;
export const VERSE_CARD_SEC = 2.5;
export const END_CARD_SEC = 3;
export const MAX_FILM_SEC = 40;
export const MAX_SHOTS = 8;

const MIN_SHOT_SEC = 4;
const MAX_SHOT_SEC = 12;

function countWords(text) {
  const trimmed = typeof text === "string" ? text.trim() : "";
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

/** Seconds a line needs before clamping to the 4 to 12 second range. */
function rawSeconds(text) {
  return Math.ceil(countWords(text) / WORDS_PER_SEC + BREATH_SEC);
}

/** How long a shot speaking `text` runs: its words at speaking pace plus a breath, 4 to 12 s. */
export function shotSeconds(text) {
  return Math.min(MAX_SHOT_SEC, Math.max(MIN_SHOT_SEC, rawSeconds(text)));
}

function silentShot(id, scene, action) {
  return { id, sceneId: scene.id, speaker: null, line: null, action, note: scene.note || "", seconds: SILENT_SHOT_SEC, firstFrame: "fresh" };
}

function spokenShot(id, scene, beat) {
  return { id, sceneId: scene.id, speaker: beat.speaker, line: beat.text, action: null, note: scene.note || "", seconds: shotSeconds(beat.text), firstFrame: "fresh" };
}

function withAction(shot, text) {
  return { ...shot, action: shot.action ? `${shot.action} ${text}` : text };
}

/** Plans the shots of one scene, numbering them from `startIndex`. */
function planScene(scene, startIndex) {
  const shots = [];
  for (const beat of scene.beats) {
    const id = `sh${startIndex + shots.length + 1}`;
    if (beat.kind === "line") {
      shots.push(spokenShot(id, scene, beat));
    } else if (shots.length === 0) {
      shots.push(silentShot(id, scene, beat.text));
    } else {
      shots[shots.length - 1] = withAction(shots[shots.length - 1], beat.text);
    }
  }
  return shots.map((shot, index) => ({ ...shot, firstFrame: index === 0 ? "fresh" : "chain" }));
}

/** The parsed script as a flat, numbered list of shots. */
export function planShots(parsed) {
  const shots = [];
  for (const scene of parsed?.scenes || []) shots.push(...planScene(scene, shots.length));
  return shots;
}

function longestScene(shots, scenes) {
  const secondsByScene = new Map();
  for (const shot of shots) secondsByScene.set(shot.sceneId, (secondsByScene.get(shot.sceneId) || 0) + shot.seconds);
  let best = null;
  let bestSeconds = -1;
  for (const scene of scenes) {
    const seconds = secondsByScene.get(scene.id) || 0;
    if (seconds > bestSeconds) {
      best = scene;
      bestSeconds = seconds;
    }
  }
  return best ? { id: best.id, place: best.place } : null;
}

/** Whether the film fits: story seconds plus both cards against 40 s, and the shot and line limits. */
export function checkFilm(shots, scenes) {
  const storySec = shots.reduce((sum, shot) => sum + shot.seconds, 0);
  const filmSec = storySec + VERSE_CARD_SEC + END_CARD_SEC;
  const ok = filmSec <= MAX_FILM_SEC;
  const tooLong = shots
    .filter((shot) => shot.line && rawSeconds(shot.line) > MAX_SHOT_SEC)
    .map((shot) => ({ shotId: shot.id, words: countWords(shot.line) }));
  return {
    storySec,
    filmSec,
    ok,
    overBySec: ok ? 0 : filmSec - MAX_FILM_SEC,
    trimScene: ok ? null : longestScene(shots, scenes),
    tooLong,
    tooMany: shots.length > MAX_SHOTS,
  };
}
