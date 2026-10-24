import { z } from "zod";
import { ok, fail } from "../toolResult.js";
import { resolveOwnMediaInput } from "../mediaPath.js";
import { renderQuotaRefusal } from "../planQuota.js";
import { NORMALISERS, outputUrl } from "../jobs.js";
import { SHEET_MAX_CHARS, SHEET_MAX_LINES } from "../../lib/lyricVideo/sheetParser.js";
import {
  LYRIC_ID, LINE_ID, LYRIC_ASPECTS, LYRIC_QUALITIES, LYRIC_FITS, LINE_EFFECTS, LOOK_IDS, LOOK_ENERGIES,
  projectView, renderView, renderStarted, hasTimedLines,
} from "../lyricView.js";

// The song and background routes read only the caller's own folder. Not media_import_url: the SSRF guard refuses this server's own files.
const OWN_FOLDER = { message: "The lyric video takes only files in your own media folder (your uploads, imports and renders, see media_list)." };

const ROUTES = ["/api/lyric-video"];
const FREE_NOTE = "Free: no daily cap or plan quota is spent.";
const JOB_ID = z.string().trim().regex(/^[\w-]{1,80}$/, "a render job id");

const projectPath = (id) => `/api/lyric-video/${encodeURIComponent(id)}`;
const viewOf = (ctx, body) => ({ project: projectView(body?.project || {}, ctx.publicBase) });

/** A copy of `fields` without undefined values, so the route's own defaults apply. */
function defined(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

async function readProject(ctx, id) {
  return (await ctx.api.call("GET", projectPath(id)))?.project || {};
}

// ---- lyric_project -----------------------------------------------------------

const PROJECT_ACTIONS = ["list", "get", "create", "delete", "renders", "publish_draft", "cancel_render"];
const NEEDS_ID = new Set(["get", "delete", "publish_draft", "cancel_render"]);

async function projectAction(ctx, input) {
  const { action, id } = input;
  if (action === "list") return ok({ projects: (await ctx.api.call("GET", "/api/lyric-video"))?.projects || [] });
  if (action === "renders") {
    const renders = (await ctx.api.call("GET", "/api/lyric-video/renders"))?.renders || [];
    return ok({ renders: renders.map((r) => renderView(r, ctx.publicBase)) });
  }
  if (action === "create") {
    return ok(viewOf(ctx, await ctx.api.call("POST", "/api/lyric-video", { body: defined({ title: input.title, artist: input.artist }) })));
  }
  if (NEEDS_ID.has(action) && !id) return fail("BAD_INPUT", `lyric_project ${action} needs id.`);
  if (action === "get") return ok(viewOf(ctx, await ctx.api.call("GET", projectPath(id))));
  if (action === "publish_draft") return ok({ draft: (await ctx.api.call("GET", `${projectPath(id)}/publish-draft`))?.draft ?? null });
  if (action === "cancel_render") {
    if (!input.jobId) return fail("BAD_INPUT", "lyric_project cancel_render needs jobId (the id lyric_render returned).");
    await ctx.api.call("POST", `${projectPath(id)}/render/${encodeURIComponent(input.jobId)}/cancel`);
    return ok({ kind: "lyric_render", id: input.jobId, projectId: id, cancelled: true });
  }
  await ctx.api.call("DELETE", projectPath(id));
  return ok({ id, deleted: true });
}

const lyricProject = {
  name: "lyric_project",
  title: "Lyric video projects",
  description:
    "Lyric videos (song mode): a song, its lyrics timed word by word to the singing, drawn as moving captions over a background. " +
    "action list: your songs, newest first. get { id }: one song with its file, sections, lines (start and end in seconds, effect, flag when the timing could not hear it), timing state, look, branding, background, past renders and a lyric_align handle. " +
    "create { title?, artist? }: a new empty song. delete { id }: removes it and the videos made from it (refused while timing or a render runs). " +
    "renders: every video of every song, newest first, each with its video url and path. publish_draft { id }: a YouTube title, description and tags for publish_youtube. " +
    "cancel_render { id, jobId }: stop a running lyric_render. " +
    "Pipeline: create, lyric_set_song, lyric_set_lyrics, lyric_align, jobs_wait (kind lyric_align), lyric_line_update if a line is off, lyric_background, lyric_render, jobs_wait (kind lyric_render). " + FREE_NOTE,
  inputSchema: {
    action: z.enum(PROJECT_ACTIONS).describe("list, get, create, delete, renders, publish_draft or cancel_render."),
    id: LYRIC_ID.optional().describe("The song's project id (get, delete, publish_draft, cancel_render)."),
    title: z.string().trim().min(1).max(100).optional().describe("create: the song title."),
    artist: z.string().trim().max(100).optional().describe("create: the artist name, drawn on the video."),
    jobId: JOB_ID.optional().describe("cancel_render: the render's job id."),
  },
  routes: ROUTES,
  handler: projectAction,
};

// ---- lyric_set_song / lyric_set_lyrics ---------------------------------------

const lyricSetSong = {
  name: "lyric_set_song",
  title: "Set a lyric video's song",
  description:
    "Give the song its audio: path is an audio file, or a video whose sound is taken out, in your own media folder (from media_import_url or media_list); URLs, shared voice files, generated images and other paths are refused. At most 15 minutes. " +
    "A new song clears the old timing, so run lyric_align again. Waits while the file is read (seconds, up to a minute for a long video). Refused while timing or a render runs. Returns the song. " + FREE_NOTE,
  inputSchema: {
    id: LYRIC_ID.describe("The song's project id."),
    path: z.string().max(1000).describe("The audio or video file, a path in your media folder."),
  },
  routes: ROUTES,
  async handler(ctx, { id, path }) {
    const media = await resolveOwnMediaInput(ctx, path, OWN_FOLDER);
    if (media.refusal) return media.refusal;
    return ok(viewOf(ctx, await ctx.api.call("POST", `${projectPath(id)}/song`, { body: { path: media.path } })));
  },
};

const lyricSetLyrics = {
  name: "lyric_set_lyrics",
  title: "Set a lyric video's lyrics",
  description:
    "Paste the lyrics as one sheet: one sung line per line, section headings like [CHORUS] or VERSE 1: on their own line, crowd responses in brackets. Words are kept exactly as typed. " +
    `At most ${SHEET_MAX_CHARS} characters and ${SHEET_MAX_LINES} lines. Lines that did not change keep their timing; any change to the words clears it, so run lyric_align again. Refused while timing runs. Returns the song. ` + FREE_NOTE,
  inputSchema: {
    id: LYRIC_ID.describe("The song's project id."),
    sheet: z.string().min(1).max(SHEET_MAX_CHARS).describe("The whole lyric sheet."),
  },
  routes: ROUTES,
  async handler(ctx, { id, sheet }) {
    return ok(viewOf(ctx, await ctx.api.call("PUT", `${projectPath(id)}/sheet`, { body: { sheet } })));
  },
};

// ---- lyric_align / lyric_line_update -----------------------------------------

/** Refuses a song the align route would refuse (R47), so a refused timing run spends nothing. */
function alignRefusal(project) {
  if (!project.song?.file) return fail("NO_SONG", "This song has no audio yet. Call lyric_set_song first.");
  if (!Array.isArray(project.lines) || project.lines.length === 0) return fail("NO_LYRICS", "This song has no lyrics yet. Call lyric_set_lyrics first.");
  if (project.timing?.status === "running") return fail("ALREADY_RUNNING", "Timing is already running for this song. Wait for it with jobs_wait (kind lyric_align).");
  return null;
}

const lyricAlign = {
  name: "lyric_align",
  title: "Time the lyrics to the song",
  description:
    "Listen to the song and time every lyric line and word to the singing, in the background. Needs the song (lyric_set_song) and the lyrics (lyric_set_lyrics). One timing run at a time per account. " +
    "Returns a handle of kind lyric_align: call jobs_wait with kind lyric_align and the song's id. It takes about a minute per few minutes of song. done has lines { total, timed, flagged } (flagged lines could not be heard and were squeezed in: move them with lyric_line_update); a warning means a re-run failed and the earlier timing was kept. " +
    "Costs one daily render and one unit of the plan's render quota (QUOTA_EXCEEDED first when it is used up); refused at no cost without a song (NO_SONG), without lyrics (NO_LYRICS) or while timing already runs (ALREADY_RUNNING), and given back if the app refuses it. Next: lyric_background, then lyric_render.",
  inputSchema: { id: LYRIC_ID.describe("The song's project id.") },
  routes: ROUTES,
  async handler(ctx, { id }) {
    const refused = alignRefusal(await readProject(ctx, id));
    if (refused) return refused;
    const outOfQuota = await renderQuotaRefusal(ctx);
    if (outOfQuota) return outOfQuota;
    const capped = await ctx.chargeCap({ renders: 1 });
    if (capped) return capped;
    const body = await ctx.api.call("POST", `${projectPath(id)}/align`);
    return ok(NORMALISERS.lyric_align.normalise({ project: body?.project || {} }, { outputUrl: (p) => outputUrl(p, ctx.publicBase) }));
  },
};

const lyricLineUpdate = {
  name: "lyric_line_update",
  title: "Move or restyle one lyric line",
  description:
    "Change one timed line: start moves the whole line (its words move with it) to start at that second, never past its neighbours or the song's ends, and locks it so the next lyric_align keeps it. " +
    "effect picks how the line is drawn: auto, or one of pop, stack, slam, quote, curve, frame, title, echo. Line ids are in lyric_project get. Returns the song. " + FREE_NOTE,
  inputSchema: {
    id: LYRIC_ID.describe("The song's project id."),
    lineId: LINE_ID.describe("The line's id, for example l3."),
    start: z.number().min(0).max(15 * 60).optional().describe("The new start time in seconds (the line must already be timed)."),
    effect: z.enum(LINE_EFFECTS).optional().describe("How the line is drawn (auto lets the director choose)."),
  },
  routes: ROUTES,
  async handler(ctx, { id, lineId, start, effect }) {
    if (start === undefined && effect === undefined) return fail("BAD_INPUT", "Give start, effect or both.");
    const body = await ctx.api.call("PATCH", `${projectPath(id)}/lines/${encodeURIComponent(lineId)}`, { body: defined({ start, effect }) });
    return ok(viewOf(ctx, body));
  },
};

// ---- lyric_background --------------------------------------------------------

const lookSchema = z.object({
  id: z.enum(LOOK_IDS).optional().describe(`The caption look: ${LOOK_IDS.join(", ")}.`),
  energy: z.enum(LOOK_ENERGIES).optional().describe("calm, lively or wild: how hard the effects hit."),
  seed: z.number().int().min(0).max(2147483647).optional().describe("A choreography seed: another number gives another mix."),
}).strict();

const brandingSchema = z.object({
  logo: z.boolean().nullable().optional().describe("Draw your logo (branding tool); null follows your account setting."),
  intro: z.boolean().optional().describe("The title and artist credit at the start."),
  endCard: z.boolean().optional().describe("The end card."),
}).strict();

/** The background body, after the path is confined; { refusal } when the path is not the user's. */
async function backgroundBody(ctx, { path, fit }) {
  if (path === null) return { body: { path: null } };
  const media = await resolveOwnMediaInput(ctx, path, OWN_FOLDER);
  if (media.refusal) return { refusal: media.refusal };
  return { body: defined({ path: media.path, fit }) };
}

const hasFields = (value) => value && Object.keys(value).length > 0;

async function setBackground(ctx, input) {
  const { id, path, fit, look, branding } = input;
  const changes = [];
  if (path !== undefined) {
    const prepared = await backgroundBody(ctx, { path, fit });
    if (prepared.refusal) return prepared.refusal;
    changes.push(["background", prepared.body]);
  }
  if (hasFields(look)) changes.push(["look", look]);
  if (hasFields(branding)) changes.push(["branding", branding]);
  if (changes.length === 0) return fail("BAD_INPUT", "Give path, look or branding to change.");
  let body = null;
  for (const [section, patch] of changes) body = await ctx.api.call("PUT", `${projectPath(id)}/${section}`, { body: patch });
  return ok(viewOf(ctx, body));
}

const lyricBackground = {
  name: "lyric_background",
  title: "Set a lyric video's background and look",
  description:
    "Choose what the lyric video looks like. path: the background picture or video in your own media folder (media_import_url or media_list; URLs, generated images in the shared folder and other paths are refused), with fit auto, cover or contain; path null clears it (the song's cover picture, else a dark colour, is used). " +
    "look { id?, energy?, seed? }: the caption look and how hard its effects hit. branding { logo?, intro?, endCard? }: switches for your logo, the opening credit and the end card. Give any of the three; at least one. Returns the song. " + FREE_NOTE,
  inputSchema: {
    id: LYRIC_ID.describe("The song's project id."),
    path: z.string().max(1000).nullable().optional().describe("The background file in your media folder, or null to clear it."),
    fit: z.enum(LYRIC_FITS).optional().describe("How the background fills the frame (default auto)."),
    look: lookSchema.optional().describe("The caption look."),
    branding: brandingSchema.optional().describe("Logo, intro credit and end card switches."),
  },
  routes: ROUTES,
  handler: setBackground,
};

// ---- lyric_render ------------------------------------------------------------

/** Refuses a song the render route would refuse, so a refused render spends nothing. */
function renderRefusal(project) {
  if (!project.song?.file) return fail("NO_SONG", "This song has no audio yet. Call lyric_set_song first.");
  if (!hasTimedLines(project)) return fail("NOT_TIMED", "The lyrics are not timed yet. Call lyric_set_lyrics, then lyric_align, and wait for it with jobs_wait.");
  if (project.timing?.status === "running") return fail("SONG_BUSY", "Timing is running for this song. Wait for it with jobs_wait (kind lyric_align).");
  if (project.render?.activeJobId) {
    return fail("SONG_BUSY", `A video is already being made for this song (job ${project.render.activeJobId}). Wait for it with jobs_wait (kind lyric_render, projectId ${project.projectId}).`);
  }
  return null;
}

const lyricRender = {
  name: "lyric_render",
  title: "Render a lyric video",
  description:
    "Render the song into a video: the timed lyrics drawn over the background, with the song as the sound. Needs the song and its timing (lyric_align done); otherwise refused at no cost. " +
    "aspect portrait (default), landscape or square; quality 720p (default) or 1080p; shortsTrim cuts a portrait video to under three minutes for YouTube Shorts (refused when the song cannot be trimmed cleanly). " +
    "Returns a handle of kind lyric_render with the render's job id as id and the song's id as projectId: call jobs_wait with kind lyric_render, that id AND projectId. output.path is the video for publish_youtube (lyric_project publish_draft gives a title and description). " +
    "Costs one daily render and one unit of the plan's render quota (QUOTA_EXCEEDED first when it is used up). Takes about the song's length; one render per account at a time, and a server deploy stops it. It never posts anywhere. lyric_project cancel_render stops it.",
  inputSchema: {
    id: LYRIC_ID.describe("The song's project id."),
    aspect: z.enum(LYRIC_ASPECTS).optional().describe("portrait (default), landscape or square."),
    quality: z.enum(LYRIC_QUALITIES).optional().describe("720p (default) or 1080p."),
    shortsTrim: z.boolean().optional().describe("Portrait only: trim to under three minutes for Shorts."),
  },
  routes: ROUTES,
  async handler(ctx, { id, aspect, quality, shortsTrim }) {
    const refused = renderRefusal(await readProject(ctx, id));
    if (refused) return refused;
    const outOfQuota = await renderQuotaRefusal(ctx);
    if (outOfQuota) return outOfQuota;
    const capped = await ctx.chargeCap({ renders: 1 });
    if (capped) return capped;
    const response = await ctx.api.call("POST", `${projectPath(id)}/render`, { body: defined({ aspect, quality, shortsTrim }) });
    return ok(renderStarted(response?.jobId, id));
  },
};

export default [lyricProject, lyricSetSong, lyricSetLyrics, lyricAlign, lyricLineUpdate, lyricBackground, lyricRender];
