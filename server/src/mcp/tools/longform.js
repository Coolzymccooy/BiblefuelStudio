import { z } from "zod";
import { ok, fail } from "../toolResult.js";
import { resolveMediaInput } from "../mediaPath.js";
import { renderQuotaRefusal } from "../planQuota.js";
import { NORMALISERS, outputUrl } from "../jobs.js";
import { STORY_ID, STORY_STYLES, projectView as storyProjectView, missingImageCount, estimateSceneCount, runningWork } from "../storyView.js";
import { VOICE_ID_PATTERN } from "./voice.js";

// Long-form: 30 to 60 minute scripture sessions (sleep sessions). A draft is a
// story project holding an outline of sections; longform_narrate voices it and
// then runs the story pipeline (scenes and pictures), after which the story
// tools render it. The draft and narrate routes each spend one unit of the
// plan's render quota; templates, sections and reopen are free.

const SCRIPT_MAX_CHARS = 60_000;
// The longest narration a scene estimate is taken over: the charge is then the template's scene limit.
const LONGEST_SESSION_MS = 24 * 60 * 60 * 1000;

/** A copy of `fields` without undefined values, so the route's own defaults apply. */
function defined(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

/** A long-form project for an agent: the story view, its outline and narration state, and a longform job handle. */
function projectView(project, publicBase) {
  const longform = project?.longform || {};
  return {
    ...storyProjectView(project, publicBase),
    longform: {
      templateId: longform.templateId ?? null,
      summary: longform.summary ?? null,
      sections: Array.isArray(longform.sections) ? longform.sections : [],
      voiceId: longform.voiceId ?? null,
      provider: longform.provider ?? null,
      progress: longform.progress ?? null,
    },
    job: NORMALISERS.longform.normalise({ project }, { outputUrl: (p) => outputUrl(p, publicBase) }),
  };
}

const viewOf = (ctx, body) => projectView(body?.project || {}, ctx.publicBase);

// ---- longform_project --------------------------------------------------------

const sectionSchema = z.object({
  heading: z.string().max(200).optional(),
  reference: z.string().max(100).nullable().optional(),
  verseText: z.string().max(5000).optional(),
  text: z.string().trim().min(1).max(20000),
  targetSec: z.number().min(20).max(3600).optional(),
  continuation: z.boolean().optional(),
  pauseBeforeMs: z.number().int().min(0).max(60_000).optional(),
}).passthrough();

async function draft(ctx, input) {
  const { script, idea, audioPath, templateId, title, style, translation, targetSec } = input;
  if (!script && !idea && !audioPath) {
    return fail("BAD_INPUT", "longform_project draft needs script (your words, used as written), idea (an outline is written for it) or audioPath (a voice note).");
  }
  let notePath;
  if (!script && !idea) {
    const note = await resolveMediaInput(ctx, audioPath);
    if (note.refusal) return note.refusal;
    notePath = note.path;
  }
  const body = defined({ script, idea, audioPath: notePath, templateId, title, style, translation, targetSec });
  const response = await ctx.api.call("POST", "/api/longform/draft", { body });
  return ok(defined({ project: viewOf(ctx, response), suggestion: response?.suggestion }));
}

async function projectAction(ctx, input) {
  const { action, id } = input;
  if (action === "templates") return ok({ templates: (await ctx.api.call("GET", "/api/longform/templates"))?.templates || [] });
  if (action === "draft") return draft(ctx, input);
  if (!id) return fail("BAD_INPUT", `longform_project ${action} needs id.`);
  const path = `/api/longform/${encodeURIComponent(id)}`;
  if (action === "reopen") return ok({ project: viewOf(ctx, await ctx.api.call("POST", `${path}/reopen`)) });
  if (!Array.isArray(input.sections) || input.sections.length === 0) {
    return fail("BAD_INPUT", "longform_project sections needs sections: the whole outline, every section with text.");
  }
  return ok({ project: viewOf(ctx, await ctx.api.call("PATCH", `${path}/sections`, { body: { sections: input.sections } })) });
}

const longformProject = {
  name: "longform_project",
  title: "Long-form scripture sessions",
  description:
    "Long-form sessions: 30 or 60 minute scripture videos (sleep sessions: slow narration, long pauses, a dozen pictures, no captions). " +
    "action templates: the formats (id, label, length). draft { script | idea | audioPath, templateId?, title?, style?, translation?, targetSec? }: a new project holding an outline of sections. " +
    "script is your own words, split into sections as written (scripture references are filled in word for word); idea gets an outline written by AI; audioPath is a voice note in your media folder that is transcribed into the idea (URLs and other paths are refused). " +
    "Without templateId one is chosen for you (the answer says which). draft waits for the outline, up to a minute or two, and spends one unit of the plan's render quota (QUOTA_EXCEEDED when it is used up); no daily cap. " +
    "sections { id, sections }: replace the outline (every section needs text) while it is a draft. reopen { id }: put a project whose narration failed back to a draft. templates, sections and reopen are free. " +
    "Read a project with story_project get. Next: longform_narrate.",
  inputSchema: {
    action: z.enum(["templates", "draft", "sections", "reopen"]).describe("templates, draft, sections or reopen."),
    id: STORY_ID.optional().describe("The project id (sections, reopen)."),
    script: z.string().trim().min(1).max(SCRIPT_MAX_CHARS).optional().describe("draft: your script, used as written."),
    idea: z.string().trim().min(1).max(2000).optional().describe("draft: what the session is about; an outline is written for it."),
    audioPath: z.string().max(1000).optional().describe("draft: a voice note in your media folder, transcribed into the idea."),
    templateId: z.string().trim().regex(/^[\w-]{1,40}$/).optional().describe("draft: a template id from action templates."),
    title: z.string().trim().min(1).max(200).optional().describe("draft: the title."),
    style: z.enum(STORY_STYLES).optional().describe("draft: the picture style."),
    translation: z.string().trim().min(2).max(8).optional().describe("draft: the Bible translation (default kjv)."),
    targetSec: z.number().int().min(60).max(4 * 3600).optional().describe("draft from an idea: the length in seconds (default the template's)."),
    sections: z.array(sectionSchema).min(1).max(200).optional().describe("sections: the whole outline, { heading?, reference?, verseText?, text, targetSec? } each."),
  },
  routes: ["/api/longform"],
  handler: projectAction,
};

// ---- longform_narrate --------------------------------------------------------

/** Pictures the story pipeline makes after the narration: the scenes still without one, else the template's scene limit. */
function picturesAfterNarration(project) {
  if (Array.isArray(project.scenes) && project.scenes.length) return missingImageCount(project);
  return estimateSceneCount(LONGEST_SESSION_MS, project.scene);
}

function busyRefusal(project) {
  const narrating = project.status === "narrating";
  // A narration a restart stopped (alive false) is resumed by narrating again.
  if (narrating ? project.longform?.progress?.alive === false : !runningWork(project).steps) return null;
  return fail("PROJECT_BUSY", `This project is busy (${project.status}). Wait with jobs_wait (kind longform), or stop it with story_cancel.`);
}

async function narrate(ctx, { id, voiceId }) {
  const project = (await ctx.api.call("GET", `/api/story/${encodeURIComponent(id)}`))?.project || {};
  const sections = Array.isArray(project.longform?.sections) ? project.longform.sections.length : 0;
  if (sections === 0) return fail("NO_SECTIONS", "This project has no outline to narrate. Make one with longform_project draft.");
  const busy = busyRefusal(project);
  if (busy) return busy;
  const outOfQuota = await renderQuotaRefusal(ctx);
  if (outOfQuota) return outOfQuota;
  const charge = { tts: sections, images: picturesAfterNarration(project) };
  const refused = await ctx.chargeCap(charge);
  if (refused) return refused;
  await ctx.api.call("POST", `/api/longform/${encodeURIComponent(id)}/narrate`, { body: defined({ voiceId }) });
  return ok({ kind: "longform", id: String(id), status: "running", percent: null, phase: "narrating", output: null, error: null, charged: charge });
}

const longformNarrate = {
  name: "longform_narrate",
  title: "Narrate a long-form session",
  description:
    "Voice the whole outline (slowly, with the template's pauses), then cut it into scenes and make one picture per scene, all in the background. Returns a handle of kind longform: call jobs_wait with kind longform and the project id. " +
    "It reads narrating with a percent while voicing (a 30 minute session takes several minutes), then the story steps; done with phase ready_to_render means it is ready for story_settings and story_render. " +
    "If a server restart stops the narration, jobs_wait says so: call longform_narrate again (chunks already voiced are reused). story_cancel stops it. " +
    "Costs, charged together up front: one daily tts per section, daily images for the pictures (the template's scene limit, 12 for the sleep sessions; scenes already with a picture are not charged; pictures not made are not given back), and one unit of the plan's render quota (QUOTA_EXCEEDED first when it is used up). " +
    "voiceId picks the voice (default: the one used before, else the template's).",
  inputSchema: {
    id: STORY_ID.describe("The project id from longform_project draft."),
    voiceId: z.string().max(100).regex(VOICE_ID_PATTERN).optional().describe("A voice from voice_list."),
  },
  routes: ["/api/longform", "/api/story"],
  handler: narrate,
};

export default [longformProject, longformNarrate];
