import { z } from "zod";
import { NORMALISERS, outputUrl } from "./jobs.js";

/**
 * Shared pieces of the Ambient session tools (tools/ambient.js): what a session
 * looks like to an agent, and how much a step will make. Lives outside tools/
 * because the registry loads every file there as tools.
 */

// lib/ambient/projectStore.js PROJECT_ID_RE: no dots or slashes, so safe in a route path.
export const AMBIENT_ID = z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/, "an ambient session id from ambient_project");

export const AMBIENT_ASPECTS = ["landscape", "portrait", "square"];
/** lib/bible/scriptureApi.js TRANSLATIONS (niv, nkjv and nlt need the server's api.bible key). */
export const AMBIENT_TRANSLATIONS = ["kjv", "web", "asv", "bbe", "ylt", "niv", "nkjv", "nlt"];
/** Statuses whose stage rewrites the verses or the bed from its own copy: an edit made meanwhile is lost. */
export const AMBIENT_BUSY = ["voicing", "generating_images", "assembling", "rendering"];

/** A voice run speaks every verse without finished audio (lib/ambient/drops.js voiceDrops). */
const voiced = (drop) => drop?.status === "done" && Boolean(drop.audioPath);
/** An images run keeps a movement only when it is done AND has a file (lib/ambient/stages.js imagesStage). */
const pictured = (movement) => movement?.imageStatus === "done" && Boolean(movement.imagePath);

const listOf = (value) => (Array.isArray(value) ? value : []);

/** How many verses POST /voice will look up and synthesise. */
export function unvoicedCount(project) {
  return listOf(project?.drops).filter((d) => !voiced(d)).length;
}

/** How many pictures POST /images will make (or take from the image library): one named movement, all with force, else the missing ones. */
export function picturesToMake(project, { force = false, movementId = null } = {}) {
  const movements = listOf(project?.movements);
  if (movementId) return 1;
  return force ? movements.length : movements.filter((m) => !pictured(m)).length;
}

function dropView(drop) {
  return {
    id: drop.id,
    atMs: drop.atMs ?? 0,
    reference: drop.reference ?? "",
    translation: drop.translation ?? null,
    status: drop.status ?? "pending",
    error: drop.error ?? null,
    text: drop.text ?? null,
    durationMs: drop.durationMs ?? null,
  };
}

function movementView(movement, publicBase) {
  return {
    id: movement.id,
    startMs: movement.startMs ?? 0,
    endMs: movement.endMs ?? 0,
    imageStatus: movement.imageStatus ?? "pending",
    imageError: movement.imageError ?? null,
    imageSource: movement.imageSource ?? null,
    image: movement.imagePath || movement.imageUrl
      ? { url: movement.imageUrl ? outputUrl(movement.imageUrl, publicBase) : null, path: movement.imagePath ?? null }
      : null,
  };
}

/** The bed as an agent edits it: each track once (shuffle stores its expanded play order), and the last build's tracklist without server paths. */
function bedView(bed = {}) {
  const tracklist = Array.isArray(bed.builtOrder)
    ? bed.builtOrder.map((t) => ({ ref: t.ref, label: t.label ?? t.ref, credit: t.credit ?? "", startSec: t.startSec ?? 0, durationSec: t.durationSec ?? 0 }))
    : null;
  return {
    mode: bed.mode ?? "assemble",
    tracks: [...new Set(listOf(bed.trackRefs))],
    filePath: bed.filePath ?? null,
    volume: bed.volume ?? null,
    crossfadeSec: bed.crossfadeSec ?? null,
    order: bed.order ?? "shuffle",
    allowUncleared: bed.allowUncleared === true,
    tracklist,
  };
}

/**
 * A session as an agent sees it: settings, verses (with their verbatim text),
 * pictures as url and path, past uploads and an ambient job handle.
 *
 * @param {object} project the stored project
 * @param {string} publicBase
 * @param {{ interrupted?: boolean }} [payload] the rest of GET /api/ambient/:id's answer
 */
export function projectView(project, publicBase, payload = {}) {
  const drops = listOf(project?.drops);
  const movements = listOf(project?.movements);
  const job = NORMALISERS.ambient.normalise({ project, interrupted: payload.interrupted }, { outputUrl: (p) => outputUrl(p, publicBase) });
  return {
    id: project.projectId,
    title: project.title ?? "",
    theme: project.theme ?? "",
    status: project.status ?? null,
    error: project.error ?? null,
    ...(payload.interrupted ? { interrupted: true } : {}),
    targetSec: project.targetSec ?? null,
    aspect: project.aspect ?? "landscape",
    translation: project.translation ?? "kjv",
    words: project.words ?? "verses",
    motion: project.motion ?? "still",
    captions: {
      mode: project.captions ?? "static",
      span: project.captionSpan ?? "spoken",
      position: project.captionPosition ?? "lower",
      preset: project.captionPreset ?? "default",
      energy: project.captionEnergy ?? null,
      seed: project.captionSeed ?? null,
    },
    bed: bedView(project.bed),
    verses: drops.length,
    versesVoiced: drops.filter(voiced).length,
    picturesDone: movements.filter(pictured).length,
    drops: drops.map(dropView),
    movements: movements.map((m) => movementView(m, publicBase)),
    published: listOf(project.published),
    job,
  };
}

/** The handle a tool returns when it has just started ambient work in the background. */
export function startedHandle(id, phase) {
  return { kind: "ambient", id: String(id), status: "running", percent: null, phase, output: null, error: null };
}
