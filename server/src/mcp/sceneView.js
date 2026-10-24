import { z } from "zod";
import { NORMALISERS, outputUrl } from "./jobs.js";

/**
 * Shared pieces of the scene script tools (tools/sceneScript.js): the id
 * shape, what a project looks like to an agent, and the handle a tool returns
 * when it has just started work. Lives outside tools/ because the registry
 * loads every file there as tools.
 */

// lib/sceneScript/projectStore.js: project ids are lower-case uuids.
export const SCENE_SCRIPT_ID = z.string().trim()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, "a scene script id from scene_script_project");

/** A line without its word timings (an agent never needs them), with its voice file as a full url. */
function lineView(line, publicBase) {
  if (!line?.audio || typeof line.audio !== "object") return line;
  const { words, ...audio } = line.audio;
  return { ...line, audio: { ...audio, url: audio.url ? outputUrl(audio.url, publicBase) : null } };
}

/** The route's project view for an agent: word timings dropped, plus a scene job handle. */
export function projectView(project, publicBase) {
  const lines = Array.isArray(project?.lines) ? project.lines : [];
  return {
    ...project,
    lines: lines.map((line) => lineView(line, publicBase)),
    job: NORMALISERS.scene.normalise({ project }, { outputUrl: (p) => outputUrl(p, publicBase) }),
  };
}

/** What runs on the project now, from the route's view. */
export function runningOf(project) {
  const running = project?.running || {};
  return {
    voice: Boolean(running.voice) || project?.voice?.status === "running",
    shots: Boolean(running.shots),
    render: Boolean(running.render) || ["queued", "rendering"].includes(project?.render?.status),
  };
}

/** The handle a tool returns when it has just started scene script work. */
export function startedHandle(id, phase) {
  return { kind: "scene", id: String(id), status: "running", percent: null, phase, output: null, error: null };
}
