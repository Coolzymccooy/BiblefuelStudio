import path from "node:path";
import { z } from "zod";
import { ok, fail, withoutOk } from "../toolResult.js";
import { resolveMediaInput, resolveOwnMediaInput } from "../mediaPath.js";
import { planQuotaRefusal, renderQuotaRefusal } from "../planQuota.js";
import {
  MOMENT_ID, MOMENT_OCCASIONS, MOMENT_STYLES, MOMENT_LENGTHS, MOMENT_DETAIL_FIELDS, MIN_PHOTOS, MAX_PHOTOS, SCRIPT_MAX,
  PHOTO_UPLOAD_NAME, projectView, summaryView, isRendering, renderStarted,
} from "../momentsView.js";

const ROUTES = ["/api/moments"];
const FREE_NOTE = "Free: no daily cap or plan quota is spent.";
const MUSIC_REF = /^(?:library|mylib):[\w.-]+$/;
// The render reads a song file only from the caller's own outputs (resolveTrackFile), so a shared voice file is refused here.
const SONG_OWN_FOLDER = { message: "A Moment's song takes only files in your own media folder (your uploads, imports and renders, see media_list)." };
const BUSY_MESSAGE = "This Moment is rendering. Wait for it with jobs_wait (kind moments), or stop it with moments_cancel.";

const projectPath = (id) => `/api/moments/${encodeURIComponent(id)}`;
const viewOf = (ctx, body) => ({ project: projectView(body?.project || {}, ctx.publicBase) });

/** A copy of `fields` without undefined values, so the route keeps what is not being changed. */
function defined(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

async function readMoment(ctx, id) {
  return (await ctx.api.call("GET", projectPath(id)))?.project || {};
}

// ---- moments_project: update --------------------------------------------------

/** One photo as the route's ref: an image imported with media_import_url (by its name), or an image library item. */
async function photoRef(ctx, photo, n) {
  const hasPath = typeof photo.path === "string";
  if (hasPath === Boolean(photo.libraryId)) return { refusal: fail("BAD_INPUT", `Photo ${n}: give either path or libraryId.`) };
  if (!hasPath) return { ref: { kind: "library", id: photo.libraryId } };
  const media = await resolveMediaInput(ctx, photo.path);
  if (media.refusal) return { refusal: media.refusal };
  const name = path.basename(media.path);
  if (!PHOTO_UPLOAD_NAME.test(name)) {
    return { refusal: fail("BAD_PHOTO", `Photo ${n}: a Moment takes images imported with media_import_url (kind image), named bg-image-..., or image library items (moments_project meta). Import this picture first.`) };
  }
  return { ref: { kind: "upload", path: name } };
}

async function photoRefs(ctx, photos) {
  const refs = [];
  for (let i = 0; i < photos.length; i += 1) {
    const one = await photoRef(ctx, photos[i], i + 1);
    if (one.refusal) return one;
    refs.push(one.ref);
  }
  return { refs };
}

/** The song as the route's ref: a library:/mylib: ref as given, or an audio file in the caller's own media folder; null clears it. */
async function songRef(ctx, song) {
  if (song === null) return { song: null };
  const hasPath = typeof song.path === "string";
  if (hasPath === Boolean(song.ref)) return { refusal: fail("BAD_INPUT", "song: give either ref (from music_library) or path.") };
  let ref = song.ref;
  if (hasPath) {
    const media = await resolveOwnMediaInput(ctx, song.path, SONG_OWN_FOLDER);
    if (media.refusal) return { refusal: media.refusal };
    ref = media.path;
  } else if (!MUSIC_REF.test(ref)) {
    return { refusal: fail("BAD_INPUT", "song.ref must be a library:... or mylib:... ref from music_library.") };
  }
  return { song: defined({ ref, windowStartSec: song.windowStartSec }) };
}

async function soundPatch(ctx, input) {
  const sound = {};
  if (input.song !== undefined) {
    const checked = await songRef(ctx, input.song);
    if (checked.refusal) return checked;
    sound.song = checked.song;
  }
  if (input.removeVoiceover) sound.voiceover = null;
  return { sound: Object.keys(sound).length ? sound : undefined };
}

async function updateBody(ctx, input) {
  const { occasion, title, details, statements, heroIndex, style, energy, lengthSec, seed } = input;
  let photos;
  if (input.photos) {
    const checked = await photoRefs(ctx, input.photos);
    if (checked.refusal) return checked;
    photos = checked.refs;
  }
  const sound = await soundPatch(ctx, input);
  if (sound.refusal) return sound;
  const body = defined({ occasion, title, details, statements, heroIndex, style, energy, lengthSec, seed, photos, sound: sound.sound });
  if (Object.keys(body).length === 0) return { refusal: fail("BAD_INPUT", "moments_project update needs at least one field to change.") };
  return { body };
}

// ---- moments_project ---------------------------------------------------------

async function meta(ctx) {
  const [choices, library] = await Promise.all([
    ctx.api.call("GET", "/api/moments/meta"),
    ctx.api.call("GET", "/api/moments/library-images"),
  ]);
  return ok({ ...withoutOk(choices), libraryImages: library?.images || [] });
}

async function projectAction(ctx, input) {
  const { action, id } = input;
  if (action === "meta") return meta(ctx);
  if (action === "list") {
    const rows = (await ctx.api.call("GET", "/api/moments"))?.projects || [];
    return ok({ projects: rows.map((row) => summaryView(row, ctx.publicBase)) });
  }
  if (action === "create") {
    if (!input.occasion) return fail("BAD_INPUT", "moments_project create needs occasion.");
    return ok(viewOf(ctx, await ctx.api.call("POST", "/api/moments", { body: { occasion: input.occasion } })));
  }
  if (!id) return fail("BAD_INPUT", `moments_project ${action} needs id.`);
  if (action === "get") return ok(viewOf(ctx, await ctx.api.call("GET", projectPath(id))));
  if (action === "update") {
    const prepared = await updateBody(ctx, input);
    if (prepared.refusal) return prepared.refusal;
    return ok(viewOf(ctx, await ctx.api.call("PUT", projectPath(id), { body: prepared.body })));
  }
  await ctx.api.call("DELETE", projectPath(id));
  return ok({ id, deleted: true });
}

const photoSchema = z.object({
  path: z.string().max(1000).optional().describe("An image in your media folder imported with media_import_url (kind image)."),
  libraryId: z.string().trim().regex(/^[\w.-]{1,100}$/).optional().describe("An image library id from moments_project meta (libraryImages)."),
}).strict();

const songSchema = z.object({
  ref: z.string().trim().max(200).optional().describe("A library:... or mylib:... ref from music_library."),
  path: z.string().max(1000).optional().describe("Or an audio file in your media folder."),
  windowStartSec: z.number().min(0).max(3600).optional().describe("Where in the song the Moment starts, in seconds (default: the best part, found automatically)."),
}).strict();

const momentsProject = {
  name: "moments_project",
  title: "Moments projects",
  description:
    "Moments: short photo videos (15, 30 or 60 seconds) for birthdays, weddings, sermons and church events, with moving titles and lines over the photos, set to a song and an optional voiceover. " +
    "action meta: the occasions (each with its detail fields), styles, lengths, limits and your image library (libraryImages, usable as photos). list: your Moments, newest first. get { id }: one Moment with its words, photos, song, voiceover, past videos and (after a render) a moments job handle. " +
    "create { occasion }: a new Moment with that occasion's style, energy and song. delete { id }. " +
    `update { id, ... }: change any of occasion, title, details { name, milestone, eventTitle, date, venue, verse }, statements (the lines shown, at most 16; a Moment uses 3 for 15 s up to 16 for 180 s), photos (the WHOLE list, ${MIN_PHOTOS} to ${MAX_PHOTOS}: each { path } of an image imported with media_import_url kind image, or { libraryId }), heroIndex, style, energy (0 to 1), lengthSec, seed, song ({ ref } from music_library, or { path } of an audio file in your own media folder: your uploads, imports and renders; null for none) and removeVoiceover. Paths outside your media folder and URLs are refused. Refused while rendering. ` +
    "Pipeline: create, update (photos, details), moments_step statements (then update with the lines you like), optionally moments_step voiceover, moments_render, jobs_wait (kind moments). " + FREE_NOTE,
  inputSchema: {
    action: z.enum(["list", "get", "create", "update", "delete", "meta"]).describe("list, get, create, update, delete or meta."),
    id: MOMENT_ID.optional().describe("The Moment's id (get, update, delete)."),
    occasion: z.enum(MOMENT_OCCASIONS).optional().describe("create (required) or update: what the Moment is for."),
    title: z.string().max(40).optional().describe("update: the big title (at most 40 characters)."),
    details: z.record(z.enum(MOMENT_DETAIL_FIELDS), z.string().max(80)).optional().describe("update: the occasion's details, for example { name: \"Ada\", milestone: \"40 years\" }."),
    statements: z.array(z.string().trim().min(1).max(60)).max(8).optional().describe("update: the lines shown, in order (each at most 60 characters)."),
    photos: z.array(photoSchema).max(MAX_PHOTOS).optional().describe("update: every photo, in order."),
    heroIndex: z.number().int().min(0).max(MAX_PHOTOS - 1).optional().describe("update: which photo is the hero (0-based)."),
    style: z.enum(MOMENT_STYLES).optional().describe("update: glow, celebrate, hype or gallery."),
    energy: z.number().min(0).max(1).optional().describe("update: how lively the motion is, 0 to 1."),
    lengthSec: z.union(MOMENT_LENGTHS.map((n) => z.literal(n))).optional().describe("update: 15, 30 or 60 seconds."),
    seed: z.number().int().min(0).max(2147483647).optional().describe("update: the choreography seed."),
    song: songSchema.nullable().optional().describe("update: the song, or null for none."),
    removeVoiceover: z.boolean().optional().describe("update: true removes the voiceover."),
  },
  routes: ROUTES,
  handler: projectAction,
};

// ---- moments_step ------------------------------------------------------------

async function voiceover(ctx, { id, script, idea, voiceId }) {
  const typed = String(script ?? "").trim();
  if (!typed && String(idea ?? "").trim().length < 3) {
    return fail("BAD_INPUT", "voiceover needs script (the words to speak) or idea (at least 3 characters, for the AI to write them).");
  }
  if (isRendering(await readMoment(ctx, id))) return fail("MOMENT_BUSY", BUSY_MESSAGE);
  const outOfQuota = await planQuotaRefusal(ctx, "tts");
  if (outOfQuota) return outOfQuota;
  const capped = await ctx.chargeCap({ tts: 1 });
  if (capped) return capped;
  const body = defined({ script: typed || undefined, idea: typed ? undefined : idea, voiceId });
  return ok(viewOf(ctx, await ctx.api.call("POST", `${projectPath(id)}/voiceover`, { body })));
}

const momentsStep = {
  name: "moments_step",
  title: "Suggest a Moment's lines or make its voiceover",
  description:
    "statements: suggest a title and lines for the Moment from its occasion, details and length. It changes nothing: put the ones you like in with moments_project update (title, statements). Waits for the answer (seconds); counts one unit of the plan's scripts quota, no daily cap. " +
    `voiceover: speak a voiceover over the Moment, from script (your words) or idea (the AI writes it, about the Moment's length), up to ${SCRIPT_MAX} characters, with voiceId (an edge voice from voice_list; default voice otherwise). It replaces any voiceover the Moment had. ` +
    "Costs one daily tts and one unit of the plan's tts quota (checked first). Waits for the voice (seconds). Refused while rendering. Returns the Moment.",
  inputSchema: {
    id: MOMENT_ID.describe("The Moment's id."),
    step: z.enum(["statements", "voiceover"]).describe("statements or voiceover."),
    script: z.string().max(SCRIPT_MAX).optional().describe("voiceover: the exact words to speak."),
    idea: z.string().max(SCRIPT_MAX).optional().describe("voiceover: what the voiceover should say, for the AI to write."),
    voiceId: z.string().trim().regex(/^[\w-]{1,100}$/).optional().describe("voiceover: an edge voice id from voice_list."),
  },
  routes: ROUTES,
  async handler(ctx, input) {
    if (input.step === "voiceover") return voiceover(ctx, input);
    const body = await ctx.api.call("POST", `${projectPath(input.id)}/statements`);
    return ok({ suggestion: body?.suggestion ?? null });
  },
};

// ---- moments_render / moments_cancel -----------------------------------------

const momentsRender = {
  name: "moments_render",
  title: "Render a Moment",
  description:
    `Render the Moment into a video: the photos cut to the song's beat with the title, lines and voiceover. Needs at least ${MIN_PHOTOS} photos (moments_project update); otherwise refused at no cost. seed gives another choreography. ` +
    "Returns a handle of kind moments: call jobs_wait with kind moments and the Moment's id until done; output.path is the video for publish_youtube or publish_post. " +
    "Costs one daily render and one unit of the plan's render quota (QUOTA_EXCEEDED first when it is used up). Takes a minute or two (it may wait for another video to finish first); a server deploy stops it. It never posts anywhere. moments_cancel stops it.",
  inputSchema: {
    id: MOMENT_ID.describe("The Moment's id."),
    seed: z.number().int().min(0).max(2147483647).optional().describe("A choreography seed (default: the Moment's own)."),
  },
  routes: ROUTES,
  async handler(ctx, { id, seed }) {
    const moment = await readMoment(ctx, id);
    if (isRendering(moment)) return fail("MOMENT_BUSY", BUSY_MESSAGE);
    if ((moment.photos || []).length < MIN_PHOTOS) {
      return fail("NEEDS_PHOTOS", `A Moment needs at least ${MIN_PHOTOS} photos. Add them with moments_project update.`);
    }
    const outOfQuota = await renderQuotaRefusal(ctx);
    if (outOfQuota) return outOfQuota;
    const capped = await ctx.chargeCap({ renders: 1 });
    if (capped) return capped;
    const response = await ctx.api.call("POST", `${projectPath(id)}/render`, { body: defined({ seed }) });
    return ok(renderStarted(id, response?.jobId));
  },
};

const momentsCancel = {
  name: "moments_cancel",
  title: "Stop a Moment's render",
  description:
    "Stop the Moment's running render; it then reads cancelled. NOTHING_RUNNING when no render is running (a render a server restart stopped needs no cancel: call moments_render again). Instant. " + FREE_NOTE,
  inputSchema: { id: MOMENT_ID.describe("The Moment's id.") },
  routes: ROUTES,
  async handler(ctx, { id }) {
    if (!isRendering(await readMoment(ctx, id))) return fail("NOTHING_RUNNING", "This Moment has no render running.");
    await ctx.api.call("POST", `${projectPath(id)}/cancel`);
    return ok({ kind: "moments", id, cancelled: true });
  },
};

export default [momentsProject, momentsStep, momentsRender, momentsCancel];
