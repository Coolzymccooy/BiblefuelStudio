/**
 * What a scene-script project's job handle says (kind `scene`, status route
 * GET /api/scene-script/:id). One handle covers the project's three stages:
 * voicing its lines, making its shots' AI clips, and rendering. While a stage
 * runs the handle is running with that stage as the phase; once nothing runs it
 * is failed if any stage left a problem (each named), cancelled when a render
 * was stopped, and otherwise done: with the video once rendered, else with the
 * phase saying whether the project is ready to render (and its blockers if not).
 *
 * Pure: jobs.js builds the handle from this. No imports, so jobs.js can import it.
 */

const CLIP_IN_FLIGHT = new Set(["queued", "generating"]);
const RENDER_RUNNING = new Set(["queued", "rendering"]);

const list = (value) => (Array.isArray(value) ? value : []);
const words = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);

/** The share of `items` that `isSettled`, as a whole percent; null without items. */
function share(items, isSettled) {
  if (items.length === 0) return null;
  return Math.round((items.filter(isSettled).length / items.length) * 100);
}

const lineVoiced = (line) => Boolean(line?.audio) && !line?.audioError;
const shotSettled = (shot) => shot?.clip?.status === "done" || shot?.clip?.status === "error";

/** Per-stage summary, so an agent can tell which stage a failure belongs to. */
function stagesOf(project, lines, shots) {
  return {
    voice: words(project.voice?.status) || "none",
    linesVoiced: lines.filter(lineVoiced).length,
    lines: lines.length,
    shotsWithClip: shots.filter((s) => s?.clip?.status === "done").length,
    shotsFailed: shots.filter((s) => s?.clip?.status === "error").length,
    shots: shots.length,
    render: words(project.render?.status) || "none",
  };
}

function runningStage(project, lines, shots) {
  const running = project.running || {};
  const render = project.render || {};
  if (running.render || RENDER_RUNNING.has(render.status)) {
    const percent = Number.isFinite(Number(render.progress)) ? Number(render.progress) : null;
    return { phase: "rendering", percent };
  }
  if (running.shots || shots.some((s) => CLIP_IN_FLIGHT.has(s?.clip?.status))) {
    return { phase: "making_shots", percent: share(shots, shotSettled) };
  }
  if (running.voice || project.voice?.status === "running") return { phase: "voicing", percent: share(lines, lineVoiced) };
  return null;
}

/** Each stage's problem, labelled with the stage, oldest stage first. */
function problemsOf(project, shots) {
  const problems = [];
  if (project.voice?.status === "error") problems.push(`Voicing: ${words(project.voice.error) || "some lines could not be voiced."}`);
  const failed = shots.filter((s) => s?.clip?.status === "error");
  if (failed.length) {
    problems.push(`Shots: ${failed.length} of ${shots.length} shots have no clip (${words(failed[0].clip.error) || "the clip failed"}).`);
  }
  if (project.render?.status === "error") problems.push(`Render: ${words(project.render.error) || "the render failed."}`);
  return problems;
}

/**
 * @param {object} project the route's project view (with running, blockers and render)
 * @returns {{ rawStatus: string, percent: number|null, phase: string|null, error: string|null,
 *   file: string|null, stages: object, blockers?: string[] }}
 */
export function sceneState(project = {}) {
  const lines = list(project.lines);
  const shots = list(project.shots);
  const stages = stagesOf(project, lines, shots);
  const base = { percent: null, phase: null, error: null, file: null, stages };
  const running = runningStage(project, lines, shots);
  if (running) return { ...base, ...running, rawStatus: "running" };
  const problems = problemsOf(project, shots);
  if (problems.length) return { ...base, rawStatus: "failed", error: problems.join(" ") };
  if (project.render?.status === "cancelled") return { ...base, rawStatus: "cancelled", error: "Render cancelled." };
  if (project.render?.status === "done") return { ...base, rawStatus: "done", phase: "rendered", file: words(project.render.url) };
  const blockers = list(project.blockers).filter((b) => typeof b === "string");
  if (blockers.length) return { ...base, rawStatus: "done", phase: "not_ready", blockers };
  return { ...base, rawStatus: "done", phase: "ready_to_render" };
}
