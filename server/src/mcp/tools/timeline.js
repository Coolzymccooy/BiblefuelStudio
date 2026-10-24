import { z } from "zod";
import { ok, fail } from "../toolResult.js";
import { renderQuotaRefusal } from "../planQuota.js";
import { NORMALISERS, outputUrl } from "../jobs.js";
import { TIMELINE_ID, TIMELINE_QUALITIES, PROJECT_SCHEMA, summaryView, confineAssets, voicePlaceholderCount } from "../timelineView.js";

const ROUTES = ["/api/timeline"];
const STYLE_WORD = z.string().trim().regex(/^[\w-]{1,60}$/);

const projectPath = (id) => `/api/timeline/projects/${encodeURIComponent(id)}`;

/** A copy of `fields` without undefined values, so the route's own defaults apply. */
function defined(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

async function readProject(ctx, id) {
  return (await ctx.api.call("GET", projectPath(id)))?.project || null;
}

// ---- timeline_project --------------------------------------------------------

async function saveProject(ctx, project) {
  if (!project) return fail("BAD_INPUT", "timeline_project save needs project.");
  // Stored with the real path each asset names, so a later render reads exactly the file that was checked.
  const checked = await confineAssets(ctx, project);
  if (checked.refusal) return checked.refusal;
  const body = await ctx.api.call("PUT", projectPath(project.id), { body: { project: checked.project } });
  return ok({ project: body?.project ?? null });
}

const timelineProject = {
  name: "timeline_project",
  title: "Timeline projects",
  description:
    "Timeline: a multi-lane editor. A project has assets (by id: kind video, audio, image, caption or effect; a path, or for a chatterbox or fish voiceover a prompt to speak) and tracks (lanes of kind video, broll, voiceover, music, captions or effects), each with clips { id, assetId, startSec, durationSec, text? for captions }. aspect 16:9, 9:16 or 1:1. " +
    "action list: your projects, newest first (counts only). get { id }: one whole project. save { project }: create or replace a project (the whole object, with id and title); the app's Timeline page opens it too. " +
    "Every asset path must be a file in your media folder (media_import_url, media_list or another tool's output) or a library:/mylib: music ref from music_library; URLs, library item ids and other paths are refused. " +
    "Next: timeline_render. Free: no daily cap or plan quota is spent.",
  inputSchema: {
    action: z.enum(["list", "get", "save"]).describe("list, get or save."),
    id: TIMELINE_ID.optional().describe("get: the project id."),
    project: PROJECT_SCHEMA.optional().describe("save: the whole project."),
  },
  routes: ROUTES,
  async handler(ctx, { action, id, project }) {
    if (action === "list") {
      const projects = (await ctx.api.call("GET", "/api/timeline/projects"))?.projects || [];
      return ok({ projects: projects.map(summaryView) });
    }
    if (action === "save") return saveProject(ctx, project);
    if (!id) return fail("BAD_INPUT", "timeline_project get needs id.");
    return ok({ project: await readProject(ctx, id) });
  },
};

// ---- timeline_render ---------------------------------------------------------

/** The project to render (saved, or given), with every asset path replaced by the real file it names. */
async function renderableProject(ctx, { projectId, project }) {
  if (Boolean(projectId) === Boolean(project)) return { refusal: fail("BAD_INPUT", "Give either projectId (a saved project) or project (a whole project).") };
  const source = project || (await readProject(ctx, projectId));
  if (!source) return { refusal: fail("NOT_FOUND", "That timeline project was not found.") };
  return confineAssets(ctx, source);
}

async function startRender(ctx, input) {
  const prepared = await renderableProject(ctx, input);
  if (prepared.refusal) return prepared.refusal;
  const voices = voicePlaceholderCount(prepared.project);
  const outOfQuota = await renderQuotaRefusal(ctx);
  if (outOfQuota) return outOfQuota;
  const capped = await ctx.chargeCap(voices > 0 ? { renders: 1, tts: voices } : { renders: 1 });
  if (capped) return capped;
  const { quality, typographyPreset, captionEnergy, captionSeed, captionMotion, captionLayout, captionStagger, captionHighlight } = input;
  const body = defined({
    project: prepared.project, quality, typographyPreset, captionEnergy, captionSeed, captionMotion, captionLayout, captionStagger, captionHighlight,
  });
  const response = await ctx.api.call("POST", "/api/timeline/render", { body });
  const handle = NORMALISERS.timeline.normalise(response, { outputUrl: (p) => outputUrl(p, ctx.publicBase) });
  return ok({ ...handle, ttsCharged: voices });
}

const timelineRender = {
  name: "timeline_render",
  title: "Render a timeline",
  description:
    "Render a timeline project into one video: projectId (a saved project) or project (a whole project, rendered without saving). Asset paths follow the timeline_project rule (refused otherwise, at no cost). " +
    "quality proof_720p (default), standard_1080p or final_1080p; typographyPreset, captionEnergy (calm, lively, wild), captionSeed, captionMotion, captionLayout, captionStagger and captionHighlight style the captions (default: the project's renderSettings). " +
    "Returns a handle of kind timeline: call jobs_wait with kind timeline and the handle's id until done; output.url plays the video and output.path (in your media folder) is the video for publish_youtube or publish_post. " +
    "Costs one daily render and one unit of the plan's render quota (QUOTA_EXCEEDED first), plus one daily tts for each voiceover clip it must speak (a chatterbox or fish asset with a prompt and no path), all charged together up front. Takes minutes; a server deploy stops it. It never posts anywhere.",
  inputSchema: {
    projectId: TIMELINE_ID.optional().describe("A saved project's id."),
    project: PROJECT_SCHEMA.optional().describe("Or a whole project to render as it is."),
    quality: z.enum(TIMELINE_QUALITIES).optional().describe("proof_720p (default), standard_1080p or final_1080p."),
    typographyPreset: STYLE_WORD.optional().describe("A caption style or Studio look id."),
    captionEnergy: z.enum(["calm", "lively", "wild"]).optional().describe("How hard Studio caption effects hit."),
    captionSeed: z.number().int().min(0).max(2147483647).optional().describe("A caption choreography seed."),
    captionMotion: STYLE_WORD.optional().describe("A caption motion name."),
    captionLayout: STYLE_WORD.optional().describe("A caption layout name."),
    captionStagger: z.boolean().optional().describe("Bring caption words in one after another."),
    captionHighlight: z.boolean().optional().describe("Highlight the word being spoken."),
  },
  routes: ROUTES,
  handler: startRender,
};

export default [timelineProject, timelineRender];
