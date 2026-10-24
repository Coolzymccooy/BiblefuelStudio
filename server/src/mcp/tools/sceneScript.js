import { z } from "zod";
import { ok, fail, withoutOk } from "../toolResult.js";
import { SCENE_SCRIPT_ID, projectView, runningOf, startedHandle } from "../sceneView.js";

// Scene scripts: an authored cinematic script, voiced word for word, its shots
// made as AI clips, rendered. Super-admin keys only, as the routes are. The
// router spends no plan quota (super admins are unlimited), so these tools
// charge only the key's daily caps, in their handlers, after their own checks.

const MAX_MARKDOWN_CHARS = 40_000;
const CENT_EPSILON = 1e-9;
const ITEM_ID = z.string().trim().regex(/^[\w-]{1,80}$/);
const BED_REF = z.string().regex(/^(library|mylib):[A-Za-z0-9_-]{1,80}$/, "a library:... or mylib:... ref from music_library");
const PERCENT = z.string().regex(/^[+-]?\d{1,3}%$/, "a percent such as -10% or +5%");
const FREE_NOTE = "Free: no daily cap.";

const projectPath = (id) => `/api/scene-script/${encodeURIComponent(id)}`;
const roundUpToCent = (usd) => Math.ceil(Number(usd) * 100 - CENT_EPSILON) / 100;

/** A copy of `fields` without undefined values, so the route's own defaults apply. */
function defined(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

async function readProject(ctx, id) {
  const body = await ctx.api.call("GET", projectPath(id));
  return body?.project || {};
}

const viewOf = (ctx, body) => ({ project: projectView(body?.project || {}, ctx.publicBase) });

function busyRefusal(project, stages) {
  const running = runningOf(project);
  const busy = stages.filter((stage) => running[stage]);
  if (busy.length === 0) return null;
  return fail("PROJECT_BUSY", `This scene script is busy (${busy.join(", ")}). Wait with jobs_wait (kind scene), or stop it with scene_script_cancel.`);
}

// ---- scene_script_project ----------------------------------------------------

const ACTIONS = ["list", "get", "create", "update", "delete", "parse", "voices"];
const EDIT_FIELDS = ["title", "cast", "look", "captions", "endCard", "lines", "shots", "cues"];

const castEntry = z.object({
  voice: z.string().max(80).optional(),
  rate: PERCENT.optional(),
  pitch: PERCENT.optional(),
  room: z.string().max(20).optional(),
  ensemble: z.array(z.object({ voice: z.string().max(80), pitch: PERCENT.optional(), offsetMs: z.number().min(0).max(400).optional() })).max(6).optional(),
});
const lineEdit = z.object({
  id: ITEM_ID,
  text: z.string().max(500).optional(),
  retake: z.boolean().optional(),
  speaker: z.string().max(80).optional(),
  voice: z.string().max(80).nullable().optional(),
  rate: PERCENT.nullable().optional(),
  pitch: PERCENT.nullable().optional(),
  gapAfter: z.number().min(0).max(10).nullable().optional(),
});
const refineEdit = z.object({
  in: z.number().min(0).optional(), out: z.number().min(0).nullable().optional(), rate: z.number().nullable().optional(),
  flip: z.boolean().optional(), zoom: z.number().min(1).optional(), x: z.number().min(-1).max(1).optional(),
  y: z.number().min(-1).max(1).optional(), grade: z.string().max(40).optional(),
});
const shotEdit = z.object({
  id: ITEM_ID,
  prompt: z.string().max(1500).nullable().optional(),
  accept: z.boolean().optional(),
  offsetSec: z.number().min(-3).max(10).optional(),
  refine: refineEdit.nullable().optional(),
});
const cueEdit = z.object({ id: ITEM_ID, bed: BED_REF.optional(), offsetSec: z.number().min(0).max(3600).optional() });

function needMarkdown(action, markdown) {
  return markdown ? null : fail("BAD_INPUT", `scene_script_project ${action} needs markdown (the script).`);
}

async function updateProject(ctx, id, input) {
  const body = defined(Object.fromEntries(EDIT_FIELDS.map((field) => [field, input[field]])));
  if (Object.keys(body).length === 0) return fail("BAD_INPUT", `Give at least one of ${EDIT_FIELDS.join(", ")} to change.`);
  return ok(viewOf(ctx, await ctx.api.call("PATCH", projectPath(id), { body })));
}

async function getProject(ctx, id) {
  const body = await ctx.api.call("GET", projectPath(id));
  return ok({ ...viewOf(ctx, body), month: body?.month ?? null, seedance: Boolean(body?.seedance) });
}

async function projectAction(ctx, input) {
  const { action, id, markdown } = input;
  if (action === "list") return ok({ projects: (await ctx.api.call("GET", "/api/scene-script"))?.projects || [] });
  if (action === "voices") return ok(withoutOk(await ctx.api.call("GET", "/api/scene-script/voices")));
  if (action === "parse" || action === "create") {
    const missing = needMarkdown(action, markdown);
    if (missing) return missing;
    if (action === "parse") return ok(withoutOk(await ctx.api.call("POST", "/api/scene-script/parse", { body: { markdown } })));
    return ok(viewOf(ctx, await ctx.api.call("POST", "/api/scene-script", { body: { markdown } })));
  }
  if (!id) return fail("BAD_INPUT", `scene_script_project ${action} needs id.`);
  if (action === "get") return getProject(ctx, id);
  if (action === "update") return updateProject(ctx, id, input);
  await ctx.api.call("DELETE", projectPath(id));
  return ok({ id, deleted: true });
}

const sceneScriptProject = {
  name: "scene_script_project",
  title: "Scene script projects",
  description:
    "Scene scripts (super-admin keys): a cinematic script you wrote in markdown (TITLE line, ### Scene headings with times, *Visual:* lines, **Speaker:** lines), voiced word for word, each shot an AI video clip, rendered into one video. " +
    "parse { markdown }: what the script would become (scenes, lines, shots, warnings) and the clips' price, without saving. create { markdown }: a new project. " +
    "list: your projects. get { id }: one project (lines with voices, shots with clips, prompts and similar library clips, music cues, render), its blockers, the month's AI video spend and a scene job handle. " +
    "update { id, title?, cast?, look?, captions?, endCard?, lines?, shots?, cues? }: edit; lines, shots and cues are edits by id (a line's retake: true records it again at the next voicing; a shot's prompt null goes back to the scene's visual); a cue bed is a library:... or mylib:... ref. Refused while it renders. " +
    "delete { id } (refused while something runs). voices: the voice names, ensembles and rooms the cast takes. " +
    "Pipeline: create, scene_script_step voice, scene_script_step suggest_shots (optional), scene_script_shots, scene_script_render, jobs_wait (kind scene). " + FREE_NOTE,
  inputSchema: {
    action: z.enum(ACTIONS).describe("list, get, create, update, delete, parse or voices."),
    id: SCENE_SCRIPT_ID.optional().describe("The project id (get, update, delete)."),
    markdown: z.string().min(1).max(MAX_MARKDOWN_CHARS).optional().describe("create, parse: the whole script in markdown."),
    title: z.string().trim().min(1).max(120).optional().describe("update: the title."),
    cast: z.record(z.string().max(80), castEntry).optional().describe("update: per speaker, { voice?, rate?, pitch? } or an ensemble { ensemble, rate?, room? }; voices from action voices."),
    look: z.object({ lead: z.string().max(600).optional(), peopleNote: z.string().max(600).optional(), style: z.string().max(600).optional() }).optional().describe("update: the visual look added to every shot prompt."),
    captions: z.object({ enabled: z.boolean() }).optional().describe("update: captions on or off."),
    endCard: z.object({ reference: z.string().max(80).optional(), text: z.string().max(200).optional() }).optional().describe("update: the closing card."),
    lines: z.array(lineEdit).max(500).optional().describe("update: line edits by id."),
    shots: z.array(shotEdit).max(200).optional().describe("update: shot edits by id (prompt, accept a suggested prompt, offsetSec, refine)."),
    cues: z.array(cueEdit).max(100).optional().describe("update: music cue edits by id (bed ref, offsetSec)."),
  },
  routes: ["/api/scene-script"],
  requires: "super_admin",
  handler: projectAction,
};

// ---- scene_script_step -------------------------------------------------------

async function voice(ctx, id) {
  const project = await readProject(ctx, id);
  const busy = busyRefusal(project, ["render", "voice"]);
  if (busy) return busy;
  if (!project.needsVoice && project.voice?.status === "done") {
    return ok({ ...projectView(project, ctx.publicBase).job, ttsCharged: 0 });
  }
  const refused = await ctx.chargeCap({ tts: 1 });
  if (refused) return refused;
  await ctx.api.call("POST", `${projectPath(id)}/voice`);
  return ok({ ...startedHandle(id, "voicing"), ttsCharged: 1 });
}

async function suggestShots(ctx, id, shotIds) {
  const body = await ctx.api.call("POST", `${projectPath(id)}/suggest-shots`, { body: defined({ shotIds }) });
  return ok(viewOf(ctx, body));
}

const sceneScriptStep = {
  name: "scene_script_step",
  title: "Voice a scene script or suggest its shots",
  description:
    "voice: speak every line that needs it (new, edited or marked retake), word for word, with Azure voices, in the background; returns a handle of kind scene: call jobs_wait with kind scene and the project id (done when voicing ends; failed names lines that could not be voiced). " +
    "Costs one daily tts per call. A project whose lines are all voiced starts nothing and costs nothing. Refused while it renders or voices. " +
    "suggest_shots: an AI writes a video prompt for every shot without a clip (shotIds narrows it), marked suggested; waits for the answer, up to about a minute and a half. " + FREE_NOTE + " " +
    "Read the prompts with scene_script_project get and change them with update shots before ordering clips. Next: scene_script_shots.",
  inputSchema: {
    id: SCENE_SCRIPT_ID.describe("The project id."),
    step: z.enum(["voice", "suggest_shots"]).describe("voice or suggest_shots."),
    shotIds: z.array(ITEM_ID).min(1).max(100).optional().describe("suggest_shots only: just these shots."),
  },
  routes: ["/api/scene-script"],
  requires: "super_admin",
  async handler(ctx, { id, step, shotIds }) {
    if (step === "voice") return voice(ctx, id);
    return suggestShots(ctx, id, shotIds);
  },
};

// ---- scene_script_shots ------------------------------------------------------

function overBenchmark(estimate) {
  const total = Number(estimate.totalUsd || 0).toFixed(2);
  return fail("OVER_BENCHMARK", `This video's clips would cost about $${total} in all, above the $${estimate.benchmarkUsd} benchmark. Ask the user; only if they agree, call again with confirmOverBenchmark: true.`, { estimate });
}

async function orderShots(ctx, { id, only, estimateOnly, confirmOverBenchmark }) {
  const priced = withoutOk(await ctx.api.call("POST", `${projectPath(id)}/shots/estimate`, { body: defined({ only }) }));
  if (estimateOnly) return ok(priced);
  const estimate = priced.estimate || {};
  if (!(estimate.clips > 0) && !(estimate.refetch > 0)) return fail("NOTHING_TO_ORDER", "Every shot already has a clip (name shots in only to make them again).");
  if (estimate.overBenchmark && confirmOverBenchmark !== true) return overBenchmark(estimate);
  const usd = Math.max(0, roundUpToCent(estimate.usd || 0));
  const refused = usd > 0 ? await ctx.chargeCap({ aiVideoUsd: usd }) : null;
  if (refused) return refused;
  await ctx.api.call("POST", `${projectPath(id)}/shots`, { body: defined({ only, confirmOverBenchmark: confirmOverBenchmark === true ? true : undefined }) });
  return ok({ ...startedHandle(id, "making_shots"), clips: estimate.clips, seconds: estimate.seconds ?? null, usdCharged: usd });
}

const sceneScriptShots = {
  name: "scene_script_shots",
  title: "Make a scene script's shots as AI clips",
  description:
    "Order an AI video clip (BytePlus Seedance) for every shot without one, or just the shots in only (naming a shot that has a clip makes it again), paid in dollars from the server's shared AI video balance. " +
    "Call it first with estimateOnly: true: the price (clips, seconds, usd, the video's total so far against its benchmark) and the month's spend; nothing is ordered. " +
    "Otherwise the estimate's dollars, rounded up to the cent, are charged to the daily aiVideoUsd cap before any clip is ordered (MCP_CAP_REACHED if it does not fit; BUDGET when the month's cap is reached). Clips already made and only waiting to be fetched cost nothing. " +
    "The real cost can differ a little from the estimate and the difference is neither charged nor given back. Over the video's benchmark it is refused (OVER_BENCHMARK, uncharged) unless confirmOverBenchmark is true, which only the user may decide. " +
    "Returns a handle of kind scene: jobs_wait with kind scene shows phase making_shots, a few minutes per clip. scene_script_cancel with what shots stops further orders. Next: scene_script_render.",
  inputSchema: {
    id: SCENE_SCRIPT_ID.describe("The project id."),
    only: z.array(ITEM_ID).min(1).max(100).optional().describe("Just these shots (default: every shot without a clip)."),
    estimateOnly: z.boolean().optional().describe("true: only price it."),
    confirmOverBenchmark: z.boolean().optional().describe("true only when the user agreed to a total above the benchmark."),
  },
  routes: ["/api/scene-script"],
  requires: "super_admin",
  handler: orderShots,
};

// ---- scene_script_render -----------------------------------------------------

function notReady(project) {
  const blockers = [
    ...(project.needsVoice ? ["Some lines changed since they were voiced. Voice them again with scene_script_step voice."] : []),
    ...(Array.isArray(project.blockers) ? project.blockers : []),
  ];
  return blockers.length ? fail("NOT_READY", blockers[0], { blockers }) : null;
}

const sceneScriptRender = {
  name: "scene_script_render",
  title: "Render a scene script",
  description:
    "Render the project into one video: the clips in their places, the voiced lines, the music cues and captions. Every line must be voiced and every shot must have a clip; otherwise the call is refused (NOT_READY, with the blockers) and costs nothing. " +
    "Returns a handle of kind scene: call jobs_wait with kind scene and the project id until done; output.path is the video, which publish_youtube and publish_post take. " +
    "Costs one daily render. Takes a few minutes; a server deploy stops a running render. It never posts anywhere. scene_script_cancel with what render stops it.",
  inputSchema: { id: SCENE_SCRIPT_ID.describe("The project id.") },
  routes: ["/api/scene-script"],
  requires: "super_admin",
  async handler(ctx, { id }) {
    const project = await readProject(ctx, id);
    const refusal = busyRefusal(project, ["render", "voice", "shots"]) || notReady(project);
    if (refusal) return refusal;
    const refused = await ctx.chargeCap({ renders: 1 });
    if (refused) return refused;
    await ctx.api.call("POST", `${projectPath(id)}/render`);
    return ok(startedHandle(id, "rendering"));
  },
};

// ---- scene_script_cancel -----------------------------------------------------

const sceneScriptCancel = {
  name: "scene_script_cancel",
  title: "Stop a scene script's clips or render",
  description:
    "what shots: stop ordering clips (clips already ordered still arrive and are paid for). what render: stop the render. Voicing cannot be stopped; it finishes by itself. " +
    "NOTHING_RUNNING when nothing of that kind runs. Instant. " + FREE_NOTE,
  inputSchema: {
    id: SCENE_SCRIPT_ID.describe("The project id."),
    what: z.enum(["shots", "render"]).describe("shots or render."),
  },
  routes: ["/api/scene-script"],
  requires: "super_admin",
  async handler(ctx, { id, what }) {
    if (!runningOf(await readProject(ctx, id))[what]) {
      return fail("NOTHING_RUNNING", what === "shots" ? "No clips are being ordered for this project." : "This project is not rendering.");
    }
    await ctx.api.call("POST", `${projectPath(id)}/${what}/cancel`);
    return ok({ kind: "scene", id, cancelled: what });
  },
};

export default [sceneScriptProject, sceneScriptStep, sceneScriptShots, sceneScriptRender, sceneScriptCancel];
