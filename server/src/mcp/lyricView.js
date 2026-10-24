import { z } from "zod";
import { NORMALISERS, outputUrl } from "./jobs.js";
import { EFFECT_IDS } from "../lib/kinetic/director.js";
import { LOOKS, ENERGIES, STUDIO_PREFIX } from "../lib/kinetic/looks.js";

/**
 * Shared pieces of the lyric video tools (tools/lyric.js): what a song project
 * looks like to an agent and the choices the routes accept. Lives outside tools/
 * because the registry loads every file there as tools. The lib modules imported
 * here read no environment.
 */

// lib/lyricVideo/projectStore.js: ids are lv_ and lowercase hex, safe in a route path.
export const LYRIC_ID = z.string().trim().regex(/^lv_[a-z0-9]{1,40}$/, "a lyric video project id from lyric_project");
export const LINE_ID = z.string().trim().regex(/^[\w-]{1,40}$/, "a line id from lyric_project get");
export const LYRIC_ASPECTS = ["portrait", "landscape", "square"];
export const LYRIC_QUALITIES = ["720p", "1080p"];
export const LYRIC_FITS = ["auto", "cover", "contain"];
export const LINE_EFFECTS = ["auto", ...EFFECT_IDS];
export const LOOK_IDS = Object.keys(LOOKS).map((key) => `${STUDIO_PREFIX}${key}`);
export const LOOK_ENERGIES = ENERGIES.map((e) => e.id);

const listOf = (value) => (Array.isArray(value) ? value : []);
const placed = (line) => Array.isArray(line?.words) && line.words.length > 0 && Number.isFinite(line.start) && Number.isFinite(line.end);

/** True when at least one line has its timing (the render draws only timed lines). */
export const hasTimedLines = (project) => listOf(project?.lines).some(placed);

/** A rendered video as url and the /outputs/ path other tools accept (renders sit flat in the user's outputs). */
export function videoRef(file, publicBase) {
  const name = typeof file === "string" ? file.split(/[\\/]/).pop() : "";
  return name ? { url: outputUrl(name, publicBase), path: `/outputs/${name}` } : null;
}

function fileRef(file, publicBase) {
  return typeof file === "string" && file ? { path: file, url: outputUrl(file, publicBase) } : null;
}

function lineView(line) {
  return {
    id: line.id,
    sectionId: line.sectionId ?? null,
    kind: line.kind ?? "lead",
    text: line.text ?? "",
    start: Number.isFinite(line.start) ? line.start : null,
    end: Number.isFinite(line.end) ? line.end : null,
    effect: line.effect ?? "auto",
    flag: line.flag ?? null,
    locked: line.locked === true,
  };
}

/** One finished render of a song: its video in place of the server file. */
export function renderView({ file, ...render }, publicBase) {
  return { ...render, video: videoRef(file, publicBase) };
}

function songView(song, publicBase) {
  if (!song?.file) return null;
  return { ...fileRef(song.file, publicBase), durationSec: song.durationSec ?? null };
}

function backgroundView(background, publicBase) {
  if (!background?.file) return null;
  return { ...fileRef(background.file, publicBase), kind: background.kind ?? null, fit: background.fit ?? "auto" };
}

function timingView(timing = {}) {
  return {
    status: timing.status ?? "idle",
    progress: timing.progress ?? null,
    error: timing.error ?? null,
    lastError: timing.lastError ?? null,
    finishedAt: timing.finishedAt ?? null,
  };
}

/**
 * A song project as an agent sees it: the song and background as path and url,
 * sections and lines (their times in seconds, without the word-by-word timings),
 * the timing state, look, branding, past renders and a lyric_align handle.
 */
export function projectView(project, publicBase) {
  const toUrl = (p) => outputUrl(p, publicBase);
  return {
    id: project.projectId,
    title: project.title ?? "",
    artist: project.artist ?? "",
    song: songView(project.song, publicBase),
    sections: listOf(project.sections).map(({ id, kind, label, start }) => ({ id, kind, label, start: start ?? null })),
    lines: listOf(project.lines).map(lineView),
    timing: timingView(project.timing),
    look: project.look ?? null,
    branding: project.branding ?? null,
    background: backgroundView(project.background, publicBase),
    renders: listOf(project.renders).map((r) => renderView(r, publicBase)),
    failedRenders: listOf(project.failedRenders),
    renderingJobId: project.render?.activeJobId ?? null,
    alignJob: NORMALISERS.lyric_align.normalise({ project }, { outputUrl: toUrl }),
  };
}

/** The handle lyric_render returns for a render it has just started. */
export function renderStarted(jobId, projectId) {
  return { kind: "lyric_render", id: String(jobId ?? ""), projectId, status: "running", percent: null, phase: null, output: null, error: null };
}
