import { z } from "zod";
import { ok, fail } from "../toolResult.js";
import { resolveMediaInput } from "../mediaPath.js";
import { renderQuotaRefusal } from "../planQuota.js";
import {
  STORY_STYLES, STORY_ASPECTS, CAPTION_MODES, estimateSceneCount, missingImageCount, knownDurationMs,
  aiMotionRefusal, projectView, startedHandle, STORY_ID,
} from "../storyView.js";

const PROBE_TIMEOUT_MS = 10_000;
const PLAN_QUOTA_NOTE = "Every change to a story (create, import, delete, each step, each setting, a render) counts one unit of the plan's render quota; reads and cancels are free.";

const projectPath = (id) => `/api/story/${encodeURIComponent(id)}`;

/** A copy of `fields` without undefined values, so the route's own defaults apply. */
function defined(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

// ffprobe for a fresh recording's length, imported on first use (storyRender pulls in env-reading modules).
async function realProbe(file) {
  const { probeAudioDurationSec } = await import("../../lib/story/storyRender.js");
  return probeAudioDurationSec(file, { timeoutMs: PROBE_TIMEOUT_MS });
}
let probeDurationSec = realProbe;

/** Test seam: replace how a media file's length is read (seconds or null). Pass null to restore. */
export function _setDurationProbeForTests(fn) {
  probeDurationSec = typeof fn === "function" ? fn : realProbe;
}

async function readProject(ctx, id) {
  const body = await ctx.api.call("GET", projectPath(id));
  return body?.project || {};
}

/** Charges the pictures a step will make, after the plan quota pre-check; null or the tool error to return. */
async function chargePictures(ctx, images) {
  const outOfQuota = await renderQuotaRefusal(ctx);
  if (outOfQuota) return outOfQuota;
  return ctx.chargeCap({ images });
}

// ---- story_project -----------------------------------------------------------

const PROJECT_ACTIONS = ["list", "get", "create", "delete", "characters"];

async function projectAction(ctx, input) {
  const { action, id } = input;
  if (action === "list") return ok({ projects: (await ctx.api.call("GET", "/api/story"))?.projects || [] });
  if (action === "characters") return ok({ characters: (await ctx.api.call("GET", "/api/story/characters"))?.characters || [] });
  if (action === "create") {
    const { title, style, cast, aspect, captions } = input;
    const body = await ctx.api.call("POST", "/api/story", { body: defined({ title, style, cast, aspect, captions }) });
    return ok({ project: projectView(body?.project || {}, ctx.publicBase) });
  }
  if (!id) return fail("BAD_INPUT", `story_project ${action} needs id.`);
  if (action === "get") return ok({ project: projectView(await readProject(ctx, id), ctx.publicBase) });
  await ctx.api.call("DELETE", projectPath(id));
  return ok({ id, deleted: true });
}

const storyProject = {
  name: "story_project",
  title: "Story video projects",
  description:
    "Story videos: narration cut into scenes, one AI picture per scene, rendered with captions. " +
    "action list: your projects (id, title, status), newest first. get { id }: one project with its scenes (text, picture prompt, picture url and path, AI clip status), settings and a story job handle; the word timings are left out. " +
    "create { title?, style?, cast?, aspect?, captions? }: an empty project; then give it narration with story_process (a recording) or start from story_import_script instead. " +
    "delete { id }: removes the project and its pictures and video. characters: the cast keys story_settings and create accept. " +
    PLAN_QUOTA_NOTE + " No daily cap is spent.",
  inputSchema: {
    action: z.enum(PROJECT_ACTIONS).describe("list, get, create, delete or characters."),
    id: STORY_ID.optional().describe("The project id (get, delete)."),
    title: z.string().trim().min(1).max(200).optional().describe("create: the project title."),
    style: z.enum(STORY_STYLES).optional().describe("create: the picture style (default cinematic-bible)."),
    cast: z.array(z.string().trim().min(1).max(40)).max(20).optional().describe("create: character keys from action characters."),
    aspect: z.enum(STORY_ASPECTS).optional().describe("create: portrait (default), landscape or square."),
    captions: z.enum(CAPTION_MODES).optional().describe("create: kinetic (default, word by word), static or none."),
  },
  routes: ["/api/story"],
  handler: projectAction,
};

// ---- story_import_script -----------------------------------------------------

const wordSchema = z.object({
  text: z.string().max(200),
  startMs: z.number().min(0),
  endMs: z.number().min(0),
});

/** The narration's length for the estimate: durationMs, or the last timed word if that runs later. */
function importLengthMs({ durationMs, words }) {
  const lastWord = Array.isArray(words) && words.length ? Number(words[words.length - 1]?.endMs) || 0 : 0;
  return Math.max(Number(durationMs) || 0, lastWord);
}

async function importScript(ctx, input) {
  const audio = await resolveMediaInput(ctx, input.audioPath);
  if (audio.refusal) return audio.refusal;
  const images = input.autoStart ? estimateSceneCount(importLengthMs(input)) : 0;
  if (input.autoStart) {
    const refused = await chargePictures(ctx, images);
    if (refused) return refused;
  }
  const { script, durationMs, words, title, style, cast, aspect, captions, autoStart } = input;
  const body = defined({
    script, audioPath: audio.path, durationMs, words, title, style, cast, aspect, captions,
    // R44: the project's scene limit is the picture count charged, so the segmenter cuts no more.
    ...(autoStart ? { autoStart: true, scene: { maxScenes: images } } : {}),
  });
  const response = await ctx.api.call("POST", "/api/story/import-script", { body });
  const project = projectView(response?.project || {}, ctx.publicBase);
  if (!input.autoStart) return ok({ project });
  return ok({ ...startedHandle(project.id, "segmenting"), imagesCharged: images, project });
}

const storyImportScript = {
  name: "story_import_script",
  title: "Start a story from a written script",
  description:
    "Make a story project from words you already have and their narration: script (the text), audioPath (the narration file, for example the path voice_synthesize returned, or a file in your media folder; URLs and other paths are refused) and durationMs (its length). " +
    "words ({ text, startMs, endMs }) are the narration's timings if you have them; without them the words are spread evenly over the audio. Nothing is transcribed and the script is used as written. " +
    "Without autoStart the project waits: call story_step segment, then story_step images. With autoStart: true the server segments and makes the pictures itself; it returns a handle of kind story (call jobs_wait with kind story and the project id; done with phase ready_to_render means every scene has a picture). " +
    "autoStart costs daily images for the pictures it will make, charged up front from the narration's length (durationMs, or the last timed word if later): about one per 8 seconds, at most 60, and the project is cut into no more scenes than were charged (QUOTA_EXCEEDED first when the plan's render quota is used up). " +
    PLAN_QUOTA_NOTE + " Next: story_settings for captions and music, then story_render.",
  inputSchema: {
    script: z.string().trim().min(3).max(20000).describe("The narration text, used as written."),
    audioPath: z.string().max(1000).describe("The narration audio: a voice_synthesize path or a file in your media folder."),
    durationMs: z.number().positive().max(4 * 60 * 60 * 1000).describe("The narration's length in milliseconds."),
    words: z.array(wordSchema).max(20000).optional().describe("Timed words { text, startMs, endMs }, if you have them."),
    title: z.string().trim().min(1).max(200).optional().describe("The project title (default: the start of the script)."),
    style: z.enum(STORY_STYLES).optional().describe("The picture style (default cinematic-bible)."),
    cast: z.array(z.string().trim().min(1).max(40)).max(20).optional().describe("Character keys from story_project characters."),
    aspect: z.enum(STORY_ASPECTS).optional().describe("portrait (default), landscape or square."),
    captions: z.enum(CAPTION_MODES).optional().describe("kinetic (default), static or none."),
    autoStart: z.boolean().optional().describe("true: segment and make the pictures now (costs daily images)."),
  },
  routes: ["/api/story"],
  handler: importScript,
};

// ---- story_process -----------------------------------------------------------

/**
 * How many pictures /process will make: the scenes it has, else the scenes its narration will be cut
 * into (then also sent as maxScenes, so the segmenter cuts no more than were charged, R44).
 */
async function processPictures(project, mediaPath) {
  if (Array.isArray(project.scenes) && project.scenes.length) return { images: missingImageCount(project) };
  const known = knownDurationMs(project);
  if (known) return estimated(estimateSceneCount(known, project.scene));
  const seconds = await probeDurationSec(mediaPath);
  if (!(Number(seconds) > 0)) {
    return { refusal: fail("MEDIA_UNREADABLE", "The length of that media file could not be read. Check it plays, or trim it with media_trim, then try again.") };
  }
  return estimated(estimateSceneCount(seconds * 1000, project.scene));
}

const estimated = (images) => ({ images, maxScenes: images > 0 ? images : undefined });

async function processStory(ctx, { id, mediaPath }) {
  const media = await resolveMediaInput(ctx, mediaPath);
  if (media.refusal) return media.refusal;
  const project = await readProject(ctx, id);
  const motion = aiMotionRefusal(project);
  if (motion) return motion;
  const counted = await processPictures(project, media.path);
  if (counted.refusal) return counted.refusal;
  const refused = await chargePictures(ctx, counted.images);
  if (refused) return refused;
  const body = defined({ mediaPath: media.path, maxScenes: counted.maxScenes });
  const response = await ctx.api.call("POST", `${projectPath(id)}/process`, { body });
  // The pictures were already about to start by themselves: this call started nothing new.
  if (response?.preparing && counted.images > 0) {
    await ctx.refundCap({ images: counted.images });
    return ok({ ...startedHandle(id, "generating_images"), imagesCharged: 0 });
  }
  return ok({ ...startedHandle(id, "processing"), imagesCharged: counted.images });
}

const storyProcess = {
  name: "story_process",
  title: "Turn a recording into a story",
  description:
    "Run the whole story pipeline on a recording, in the background: transcribe mediaPath (an audio or video file in your media folder; URLs and other paths are refused), cut it into scenes and make one AI picture per scene. " +
    "Also resumes a project that stopped (pictures that failed are made again). Returns a handle of kind story: call jobs_wait with kind story and the project id. done with phase ready_to_render means every scene has a picture; failed says how many scenes have none (often the daily image quota: retry later with story_step images). " +
    "Costs daily images for the pictures it will make, charged up front: the scenes still without a picture, or for a new recording about one per 8 seconds of speech, at most 60 (estimated from the file's length); a new recording is cut into no more scenes than were charged. Plus one unit of the plan's render quota (QUOTA_EXCEEDED first when it is used up). " +
    "Takes a few minutes. Next: story_settings, then story_render.",
  inputSchema: {
    id: STORY_ID.describe("The project id from story_project create."),
    mediaPath: z.string().max(1000).describe("The recording: an audio or video file in your media folder (media_list, media_import_url)."),
  },
  routes: ["/api/story"],
  handler: processStory,
};

// ---- story_step --------------------------------------------------------------

const STEPS = ["segment", "resegment", "images"];

async function segment(ctx, id) {
  const body = await ctx.api.call("POST", `${projectPath(id)}/segment`);
  return ok({ project: projectView(body?.project || {}, ctx.publicBase) });
}

async function resegment(ctx, id) {
  const project = await readProject(ctx, id);
  const motion = aiMotionRefusal(project);
  if (motion) return motion;
  const images = estimateSceneCount(knownDurationMs(project), project.scene);
  const refused = await chargePictures(ctx, images);
  if (refused) return refused;
  await ctx.api.call("POST", `${projectPath(id)}/resegment`, { body: { maxScenes: images } });
  return ok({ ...startedHandle(id, "segmenting"), imagesCharged: images });
}

async function images(ctx, id, force) {
  const project = await readProject(ctx, id);
  const motion = aiMotionRefusal(project);
  if (motion) return motion;
  if (!Array.isArray(project.scenes) || project.scenes.length === 0) {
    return fail("NO_SCENES", "This project has no scenes yet. Call story_step with step segment first.");
  }
  const count = missingImageCount(project, { force });
  const refused = await chargePictures(ctx, count);
  if (refused) return refused;
  await ctx.api.call("POST", `${projectPath(id)}/images`, { body: { force } });
  return ok({ ...startedHandle(id, "generating_images"), imagesCharged: count });
}

const storyStep = {
  name: "story_step",
  title: "Run one story step",
  description:
    "Run one step of a story project. segment: cut the transcript into scenes, each with a picture prompt (waits for the answer, up to about half a minute; free of daily caps). Then edit prompts with story_scene_update if you like. " +
    "images: make the picture of every scene that has none (force: true remakes them all), in the background; returns a handle of kind story for jobs_wait (done with phase ready_to_render when every scene has one). Costs one daily images per picture it makes, charged up front. " +
    "resegment discards the scenes and EVERY existing picture (they are deleted and cost image quota to make again), cuts the transcript again and makes new pictures; returns a handle of kind story. Costs daily images for every new scene, about one per 8 seconds of narration, at most 60, charged up front; it cuts no more scenes than were charged. " +
    "images and resegment check the plan's render quota first (QUOTA_EXCEEDED). " + PLAN_QUOTA_NOTE,
  inputSchema: {
    id: STORY_ID.describe("The project id."),
    step: z.enum(STEPS).describe("segment, resegment or images."),
    force: z.boolean().optional().describe("images only: remake every picture, not just the missing ones."),
  },
  routes: ["/api/story"],
  async handler(ctx, { id, step, force }) {
    if (step === "segment") return segment(ctx, id);
    if (step === "resegment") return resegment(ctx, id);
    return images(ctx, id, force === true);
  },
};

// ---- story_render ------------------------------------------------------------

const storyRender = {
  name: "story_render",
  title: "Render a story video",
  description:
    "Render the story into a video: every scene's picture (or clip), the narration, the music bed and the captions. Every scene needs a picture first (story_step images; the call is refused otherwise and costs nothing). " +
    "Returns a handle of kind story: call jobs_wait with kind story and the project id until done; output.path is the video, which publish_youtube and publish_post take. " +
    "Costs one daily render and one unit of the plan's render quota (QUOTA_EXCEEDED first when it is used up). Takes about real time or longer for long narrations; a server deploy stops a running render. It never posts anywhere. story_cancel stops it.",
  inputSchema: { id: STORY_ID.describe("The project id.") },
  routes: ["/api/story"],
  async handler(ctx, { id }) {
    const outOfQuota = await renderQuotaRefusal(ctx);
    if (outOfQuota) return outOfQuota;
    const refused = await ctx.chargeCap({ renders: 1 });
    if (refused) return refused;
    const response = await ctx.api.call("POST", `${projectPath(id)}/render`);
    return ok({ ...startedHandle(id, "rendering"), jobId: response?.jobId ?? null });
  },
};

// ---- story_cancel ------------------------------------------------------------

const storyCancel = {
  name: "story_cancel",
  title: "Stop a story",
  description:
    "what render (default): stop whatever the project is doing (pictures being made or a render); it ends with status cancelled. " +
    "what animate: stop ordering AI motion clips (super-admin keys; clips already ordered still arrive and are still paid for). Free and instant.",
  inputSchema: {
    id: STORY_ID.describe("The project id."),
    what: z.enum(["render", "animate"]).optional().describe("render (default) or animate."),
  },
  routes: ["/api/story"],
  async handler(ctx, { id, what = "render" }) {
    const suffix = what === "animate" ? "/animate/cancel" : "/cancel";
    await ctx.api.call("POST", `${projectPath(id)}${suffix}`);
    return ok({ kind: "story", id, cancelled: what });
  },
};

export default [storyProject, storyImportScript, storyProcess, storyStep, storyRender, storyCancel];
