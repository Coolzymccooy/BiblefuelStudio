import { z } from "zod";
import { ok, fail } from "../toolResult.js";
import { resolveMediaInput } from "../mediaPath.js";
import { planQuotaRefusal, renderQuotaRefusal } from "../planQuota.js";
import {
  AMBIENT_ID, AMBIENT_ASPECTS, AMBIENT_TRANSLATIONS, AMBIENT_BUSY, unvoicedCount, picturesToMake, projectView, startedHandle,
  verseSpan, REFERENCE_RULE,
} from "../ambientView.js";

const MAX_TARGET_SEC = 10 * 3600;
const STYLE_WORD = /^[\w-]{1,40}$/;
const FREE_NOTE = "Free: no daily cap or plan quota is spent.";

const projectPath = (id) => `/api/ambient/${encodeURIComponent(id)}`;

/** A copy of `fields` without undefined values, so the route's own defaults apply. */
function defined(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

const viewOf = (ctx, body) => projectView(body?.project || {}, ctx.publicBase, body || {});

/** GET /api/ambient/:id: the stored project and the route's whole answer (it may say a restart stopped the session). */
async function readSession(ctx, id) {
  const body = await ctx.api.call("GET", projectPath(id));
  return { project: body?.project || {}, body: body || {} };
}

/** A stage rewrites the verses, pictures and bed from its own copy when it ends: an edit made meanwhile would be lost. */
function busyRefusal(project) {
  if (!AMBIENT_BUSY.includes(project.status)) return null;
  return fail("SESSION_BUSY", `This session is busy (${project.status}). Wait for it with jobs_wait (kind ambient), or stop it with ambient_cancel.`);
}

/** The plan quota pre-check for `planBucket`, then the daily caps; null or the tool error to return. */
async function chargeAfterPlanCheck(ctx, planBucket, caps) {
  const outOfQuota = await planQuotaRefusal(ctx, planBucket);
  if (outOfQuota) return outOfQuota;
  return ctx.chargeCap(caps);
}

// ---- ambient_project ---------------------------------------------------------

const PROJECT_ACTIONS = ["list", "get", "create", "delete", "mark_published"];

async function markPublished(ctx, { id, videoId, privacyStatus, publishAt }) {
  if (!videoId) return fail("BAD_INPUT", "ambient_project mark_published needs videoId (the YouTube video id).");
  const body = await ctx.api.call("POST", `${projectPath(id)}/published`, { body: defined({ videoId, privacyStatus, publishAt }) });
  return ok({ project: viewOf(ctx, body) });
}

async function projectAction(ctx, input) {
  const { action, id } = input;
  if (action === "list") return ok({ projects: (await ctx.api.call("GET", "/api/ambient"))?.projects || [] });
  if (action === "create") {
    const { title, theme, targetSec, aspect, translation } = input;
    const body = await ctx.api.call("POST", "/api/ambient", { body: defined({ title, theme, targetSec, aspect, translation }) });
    return ok({ project: viewOf(ctx, body) });
  }
  if (!id) return fail("BAD_INPUT", `ambient_project ${action} needs id.`);
  if (action === "get") return ok({ project: viewOf(ctx, (await readSession(ctx, id)).body) });
  if (action === "mark_published") return markPublished(ctx, input);
  await ctx.api.call("DELETE", projectPath(id));
  return ok({ id, deleted: true });
}

const ambientProject = {
  name: "ambient_project",
  title: "Ambient session projects",
  description:
    "Ambient sessions: long, music-first scripture videos (up to 10 hours). A music bed plays the whole way; Bible verses are spoken over it at intervals, each with its own picture (a movement). " +
    "action list: your sessions, newest first. get { id }: one session with its settings, verses (with their verbatim text once voiced), movements (picture url and path), bed, past uploads and an ambient job handle. " +
    "create { title?, theme?, targetSec?, aspect?, translation? }: a new session (default two hours, landscape, kjv). The theme guides the suggested verses and the pictures. " +
    "delete { id }: removes the session and its video (refused while it renders: ambient_cancel first). " +
    "mark_published { id, videoId, privacyStatus?, publishAt? }: records that the finished video was uploaded to YouTube (for example by publish_youtube), so the app's history shows it; it posts nothing. " +
    "Pipeline: create, ambient_plan, ambient_update bed (the music), ambient_step voice, ambient_step images, ambient_render, jobs_wait. " + FREE_NOTE,
  inputSchema: {
    action: z.enum(PROJECT_ACTIONS).describe("list, get, create, delete or mark_published."),
    id: AMBIENT_ID.optional().describe("The session id (get, delete, mark_published)."),
    title: z.string().trim().min(1).max(200).optional().describe("create: the session title."),
    theme: z.string().trim().max(500).optional().describe("create: what the session is about, for example rest and stillness."),
    targetSec: z.number().int().min(60).max(MAX_TARGET_SEC).optional().describe("create: the length in seconds, up to 36000 (default 7200)."),
    aspect: z.enum(AMBIENT_ASPECTS).optional().describe("create: landscape (default), portrait or square."),
    translation: z.enum(AMBIENT_TRANSLATIONS).optional().describe("create: the Bible translation (default kjv)."),
    videoId: z.string().trim().regex(/^[A-Za-z0-9_-]{6,20}$/, "a YouTube video id").optional().describe("mark_published: the YouTube video id."),
    privacyStatus: z.enum(["private", "unlisted", "public"]).optional().describe("mark_published: the upload's privacy (default private)."),
    publishAt: z.string().datetime({ offset: true }).optional().describe("mark_published: when a scheduled upload goes public (ISO 8601)."),
  },
  routes: ["/api/ambient"],
  handler: projectAction,
};

// ---- ambient_plan ------------------------------------------------------------

const ambientPlan = {
  name: "ambient_plan",
  title: "Suggest the verses of an ambient session",
  description:
    "Suggest Bible verse references for the session's theme and space them across its length (by default one every fifteen minutes; count asks for a number, spread over the whole length). " +
    "It REPLACES every verse the session has (any voicing is lost; pictures are kept by position). The words themselves are looked up verbatim later by ambient_step voice. " +
    "Waits for the answer (a few seconds). Costs one unit of the plan's daily scripts quota; no daily cap. Refused while the session is busy. " +
    "Then adjust with ambient_update section drops if you like, and call ambient_step voice. Long sessions: each verse later costs one daily tts and one daily images, so if the session needs more verses than the daily caps have left, plan fewer with count, voice them, and add the rest with ambient_update section drops over several days.",
  inputSchema: {
    id: AMBIENT_ID.describe("The session id."),
    count: z.number().int().min(1).max(200).optional().describe("How many verses (default: one per fifteen minutes)."),
  },
  routes: ["/api/ambient"],
  async handler(ctx, { id, count }) {
    const { project } = await readSession(ctx, id);
    const busy = busyRefusal(project);
    if (busy) return busy;
    const body = await ctx.api.call("POST", `${projectPath(id)}/plan`, { body: defined({ count }) });
    return ok({ project: viewOf(ctx, body) });
  },
};

// ---- ambient_step ------------------------------------------------------------

async function voice(ctx, id) {
  const { project, body } = await readSession(ctx, id);
  const busy = busyRefusal(project);
  if (busy) return busy;
  if (project.words === "none") {
    return fail("MUSIC_ONLY", "This session is music only. Switch verses back on with ambient_update section words first.");
  }
  if (!Array.isArray(project.drops) || project.drops.length === 0) {
    return fail("NO_VERSES", "This session has no verses yet. Call ambient_plan, or ambient_update section drops, first.");
  }
  const count = unvoicedCount(project);
  if (count === 0) return ok({ ...viewOf(ctx, body).job, ttsCharged: 0 });
  const refused = await chargeAfterPlanCheck(ctx, "tts", { tts: count });
  if (refused) return refused;
  await ctx.api.call("POST", `${projectPath(id)}/voice`);
  return ok({ ...startedHandle(id, "voicing"), ttsCharged: count });
}

async function images(ctx, id, { force, movementId }) {
  const { project, body } = await readSession(ctx, id);
  const busy = busyRefusal(project);
  if (busy) return busy;
  const movements = Array.isArray(project.movements) ? project.movements : [];
  if (movementId && !movements.some((m) => m.id === movementId)) {
    return fail("MOVEMENT_NOT_FOUND", "No movement has that id. Movement ids are in ambient_project get.");
  }
  const count = picturesToMake(project, { force, movementId });
  if (count === 0) return ok({ ...viewOf(ctx, body).job, imagesCharged: 0 });
  const refused = await chargeAfterPlanCheck(ctx, "imageGen", { images: count });
  if (refused) return refused;
  await ctx.api.call("POST", `${projectPath(id)}/images`, { body: defined({ force: force ? true : undefined, movementId }) });
  return ok({ ...startedHandle(id, "generating_images"), imagesCharged: count });
}

const ambientStep = {
  name: "ambient_step",
  title: "Voice the verses or make the pictures",
  description:
    "Run one step of an ambient session in the background; both return a handle of kind ambient: call jobs_wait with kind ambient and the session id. " +
    "voice: look up every verse not yet voiced, word for word, and speak it. Costs one daily tts per verse it speaks (charged up front) and one unit of the plan's daily tts quota. It speaks every unvoiced verse at once, so more verses than the daily tts cap has left are refused (MCP_CAP_REACHED): add verses with ambient_update section drops and voice them over several days. Refused for music-only sessions. " +
    "images: make one picture per movement (one per verse, or one for a music-only session) for every movement without one; force: true remakes them all, movementId remakes just that one. A picture may be reused from your image library instead of generated. " +
    "Costs one daily images per picture it will make (charged up front; reused ones are not given back) and one unit of the plan's daily image quota per call: every movementId call also counts one unit of the plan's daily image quota. " +
    "More pictures than the daily images cap has left are refused (MCP_CAP_REACHED): make them over several days, a movement at a time with movementId. " +
    "Each takes seconds per verse or picture. jobs_wait: done with phase ready_to_render when the session has what it needs; failed says how many verses or pictures are missing (often a provider or quota limit: run the step again later). " +
    "A step that has nothing to do starts nothing and costs nothing. Refused while the session is busy. Next: ambient_render.",
  inputSchema: {
    id: AMBIENT_ID.describe("The session id."),
    step: z.enum(["voice", "images"]).describe("voice or images."),
    force: z.boolean().optional().describe("images only: remake every picture."),
    movementId: z.string().trim().regex(/^[\w-]{1,80}$/).optional().describe("images only: remake the picture of this one movement."),
  },
  routes: ["/api/ambient"],
  async handler(ctx, { id, step, force, movementId }) {
    if (step === "voice") return voice(ctx, id);
    return images(ctx, id, { force: force === true, movementId });
  },
};

// ---- ambient_update ----------------------------------------------------------

const dropSchema = z.object({
  id: z.string().trim().regex(/^[\w-]{1,80}$/).optional().describe("The verse's id from ambient_project get; keep it to keep its voicing."),
  atMs: z.number().int().min(0).max(MAX_TARGET_SEC * 1000).describe("When the verse is spoken, in ms from the start."),
  reference: z.string().trim().min(3).max(100)
    .refine((ref) => verseSpan(ref) !== null, { message: `A reference must be ${REFERENCE_RULE}` })
    .describe("A Bible reference: one verse or up to 10 in one chapter, for example Psalms 23:1-3."),
  translation: z.enum(AMBIENT_TRANSLATIONS).optional().describe("The translation (default: the session's)."),
}).strict();

const SECTION_SCHEMAS = {
  drops: z.object({ drops: z.array(dropSchema).max(200).describe("drops: the WHOLE verse list (verses left out are deleted).") }).strict(),
  bed: z.object({
    mode: z.enum(["assemble", "file"]).optional().describe("bed: assemble (default) mixes trackRefs; file plays one file."),
    trackRefs: z.array(z.string().trim().min(1).max(1000)).max(400).optional().describe("bed: tracks: library:... or mylib:... refs from music_library, or audio files in your media folder."),
    filePath: z.string().trim().min(1).max(1000).nullable().optional().describe("bed: the one file for mode file (a ref or a file in your media folder); null clears it."),
    volume: z.number().min(0).max(2).optional().describe("bed: music volume, 0 to 2 (default 0.85)."),
    crossfadeSec: z.number().min(0).max(30).optional().describe("bed: seconds of crossfade between tracks (default 6)."),
    order: z.enum(["shuffle", "fixed"]).optional().describe("bed: shuffle (default) or fixed (your order, looped)."),
  }).strict(),
  motion: z.object({ motion: z.enum(["still", "drift"]).describe("motion: still pictures or a gentle drift.") }).strict(),
  words: z.object({ words: z.enum(["verses", "none"]).describe("words: spoken verses, or music only.") }).strict(),
  captions: z.object({
    mode: z.enum(["none", "static"]).optional().describe("captions: static (show each verse) or none."),
    span: z.enum(["spoken", "section"]).optional().describe("captions: show a verse while it is spoken, or for its whole movement."),
    position: z.enum(["lower", "centre"]).optional().describe("captions: lower third or centre."),
    preset: z.string().regex(STYLE_WORD).optional().describe("captions: a caption style name, for example default."),
    energy: z.enum(["calm", "lively", "wild"]).optional().describe("captions: how much the captions move."),
    seed: z.number().int().min(0).max(2147483647).optional().describe("captions: a choreography seed."),
  }).strict(),
};
const SECTIONS = Object.keys(SECTION_SCHEMAS);
const UPDATES_BUSY_STAGE = new Set(["drops", "bed"]);

const captionsBody = (c) => defined({
  captions: c.mode, captionSpan: c.span, captionPosition: c.position, captionPreset: c.preset, captionEnergy: c.energy, captionSeed: c.seed,
});

/** One bed track or file: a library/mylib ref as given, a path only inside the key owner's media folder. */
const confineTrack = (ctx, value) => resolveMediaInput(ctx, value, { allowRefs: true });

async function bedBody(ctx, patch) {
  const body = { ...patch };
  if (patch.trackRefs) {
    const refs = [];
    for (const ref of patch.trackRefs) {
      const checked = await confineTrack(ctx, ref);
      if (checked.refusal) return checked;
      refs.push(checked.path);
    }
    body.trackRefs = refs;
  }
  if (typeof patch.filePath === "string") {
    const checked = await confineTrack(ctx, patch.filePath);
    if (checked.refusal) return checked;
    body.filePath = checked.path;
  }
  return { body };
}

const UNCLEARED_MESSAGE =
  "Some of the user's own tracks have no recorded licence, so the bed was not changed (a Content ID claim takes the revenue of the whole video). " +
  "Ask the user to record each track's licence in the app's music library, or to make this bed change in the app themselves, then try again.";

/** True when a mylib ref's track has a recorded licence (GET /api/music/library); anything else is unknown. */
async function licensedRefs(ctx, refs) {
  const tracks = (await ctx.api.call("GET", "/api/music/library"))?.tracks || [];
  const recorded = new Set(tracks.filter((t) => {
    const licence = String(t?.licence || "unknown").trim().toLowerCase();
    return licence && licence !== "unknown";
  }).map((t) => t.ref));
  return refs.every((ref) => recorded.has(ref));
}

/** The tracks a bed plays: its one file in file mode, else its track list. */
function tracksInUse(bed) {
  if (bed?.mode === "file") return bed.filePath ? [bed.filePath] : [];
  return Array.isArray(bed?.trackRefs) ? bed.trackRefs : [];
}

/**
 * The tracks the route's licence gate checks on the bed it will store: the
 * track list in either mode, plus the one file in file mode.
 */
function tracksGated(bed) {
  const refs = Array.isArray(bed?.trackRefs) ? bed.trackRefs : [];
  return bed?.mode === "file" && bed.filePath ? [...refs, bed.filePath] : refs;
}

/** The bed as the route will store it: the patch over the stored bed (filePath null clears it). */
function mergedBed(stored, body) {
  return {
    mode: body.mode ?? stored?.mode,
    trackRefs: Array.isArray(body.trackRefs) ? body.trackRefs : stored?.trackRefs,
    filePath: body.filePath !== undefined ? body.filePath : stored?.filePath,
  };
}

/**
 * R46: an agent never makes the licence choice. One the user already made in
 * the app (bed.allowUncleared) covered the tracks the stored bed plays; it is
 * sent again only when the bed after the change plays no track outside those
 * that might lack a licence, so a volume change on such a bed still works.
 * A mode switch puts the other list in use, so it counts as adding it, and
 * the after side counts what the route's gate counts (the track list in file
 * mode too).
 * The route resets the choice on every change it is not sent with.
 */
async function keptLicenceChoice(ctx, stored, body) {
  if (stored?.allowUncleared !== true) return {};
  const before = new Set(tracksInUse(stored));
  const after = tracksGated(mergedBed(stored, body));
  const added = [...new Set(after)].filter((ref) => !before.has(ref) && !ref.startsWith("library:"));
  if (added.some((ref) => !ref.startsWith("mylib:"))) return {};
  if (added.length > 0 && !(await licensedRefs(ctx, added))) return {};
  return { allowUncleared: true };
}

async function patchBed(ctx, id, patch, project) {
  const prepared = await bedBody(ctx, patch);
  if (prepared.refusal) return { refusal: prepared.refusal };
  const body = { ...prepared.body, ...(await keptLicenceChoice(ctx, project.bed, prepared.body)) };
  try {
    return { body: await ctx.api.call("PATCH", `${projectPath(id)}/bed`, { body }) };
  } catch (err) {
    if (err?.name === "ApiError" && err.status === 409) return { refusal: fail("UNCLEARED_TRACKS", UNCLEARED_MESSAGE) };
    throw err;
  }
}

async function applyUpdate(ctx, id, section, patch, project) {
  if (section === "bed") return patchBed(ctx, id, patch, project);
  const body = section === "captions" ? captionsBody(patch) : patch;
  return { body: await ctx.api.call("PATCH", `${projectPath(id)}/${section}`, { body }) };
}

const ambientUpdate = {
  name: "ambient_update",
  title: "Change an ambient session",
  description:
    "Change one section of a session; patch holds that section's fields. " +
    "drops { drops: [{ id?, atMs, reference, translation? }] }: the whole verse list (send every verse; one left out is deleted; a changed reference must be voiced again). " +
    "bed { mode?, trackRefs?, filePath?, volume?, crossfadeSec?, order? }: the music. Tracks are library:... or mylib:... refs (music_library) or audio files in your media folder; URLs and other paths are refused. The user's own tracks need a recorded licence (UNCLEARED_TRACKS otherwise: only the user can record it, in the app's music library). " +
    "motion { motion: still|drift }. words { words: verses|none } (none makes a music-only session with one picture). " +
    "captions { mode?, span?, position?, preset?, energy?, seed? }. A finished session goes back to ready_to_render when its look changes. " +
    "drops and bed are refused while the session is busy. Returns the session. " + FREE_NOTE,
  inputSchema: {
    id: AMBIENT_ID.describe("The session id."),
    section: z.enum(SECTIONS).describe("drops, bed, motion, words or captions."),
    patch: z.union(SECTIONS.map((s) => SECTION_SCHEMAS[s])).describe("The section's fields (see the description)."),
  },
  routes: ["/api/ambient"],
  async handler(ctx, { id, section, patch }) {
    const parsed = SECTION_SCHEMAS[section].safeParse(patch ?? {});
    if (!parsed.success) return fail("BAD_INPUT", `That patch does not fit section ${section}: ${parsed.error.issues.map((i) => i.message).join("; ")}.`);
    if (Object.keys(parsed.data).length === 0) return fail("BAD_INPUT", `Give at least one ${section} field to change.`);
    let project = null;
    if (UPDATES_BUSY_STAGE.has(section)) {
      project = (await readSession(ctx, id)).project;
      const busy = busyRefusal(project);
      if (busy) return busy;
    }
    const result = await applyUpdate(ctx, id, section, parsed.data, project);
    if (result.refusal) return result.refusal;
    return ok({ project: viewOf(ctx, result.body) });
  },
};

// ---- ambient_render / ambient_cancel -----------------------------------------

/** The render leaves out a verse with no audio without a word: refuse until every verse is voiced (or the session is music only). */
function unvoicedRefusal(project) {
  if (project.words === "none") return null;
  const missing = unvoicedCount(project);
  if (missing === 0) return null;
  const total = Array.isArray(project.drops) ? project.drops.length : 0;
  return fail(
    "UNVOICED_VERSES",
    `${missing} of ${total} verses are not voiced yet, and the render would leave them out. Run ambient_step voice (and wait for it), or remove those verses with ambient_update section drops.`,
  );
}

const ambientRender = {
  name: "ambient_render",
  title: "Render an ambient session",
  description:
    "Build the music bed and render the session into one video: the pictures, the spoken verses over the music, and the captions. Every movement needs a picture (ambient_step images), the bed needs music (ambient_update bed) and every verse must be voiced (UNVOICED_VERSES otherwise; not for music-only sessions); it is refused while a step is still running (SESSION_BUSY). A refused call costs nothing. " +
    "Returns a handle of kind ambient: call jobs_wait with kind ambient and the session id, again and again, until done; output.path is the video, which publish_youtube takes (then ambient_project mark_published). " +
    "Long sessions take a long time: building the bed takes minutes and the render runs at about real time or slower, so a two-hour session can take an hour or more and a ten-hour one many hours. Heavy jobs run one at a time on this server: behind another render or a vocal removal it waits its turn first (jobs_wait shows phase \"waiting for another job to finish\"). " +
    "A server deploy or restart stops a running render: jobs_wait then reports failed saying so; call ambient_cancel, then ambient_render again (a bed already built is reused). " +
    "Costs one daily render and one unit of the plan's render quota (QUOTA_EXCEEDED first when it is used up). It never posts anywhere. ambient_cancel stops it.",
  inputSchema: { id: AMBIENT_ID.describe("The session id.") },
  routes: ["/api/ambient"],
  async handler(ctx, { id }) {
    const { project } = await readSession(ctx, id);
    const notReady = busyRefusal(project) || unvoicedRefusal(project);
    if (notReady) return notReady;
    const outOfQuota = await renderQuotaRefusal(ctx);
    if (outOfQuota) return outOfQuota;
    const refused = await ctx.chargeCap({ renders: 1 });
    if (refused) return refused;
    const response = await ctx.api.call("POST", `${projectPath(id)}/render`);
    return ok({ ...startedHandle(id, "assembling"), jobId: response?.jobId ?? null });
  },
};

const ambientCancel = {
  name: "ambient_cancel",
  title: "Stop an ambient session",
  description:
    "Stop the pictures being made or a render. The session then reads cancelled (status error, \"Cancelled.\"); run the step or ambient_render again to carry on. " +
    "Voicing cannot be stopped: while verses are being voiced this answers VOICING_CANNOT_CANCEL; it finishes on its own in a few seconds per verse, so wait for it with jobs_wait. " +
    "Also clears a session a server restart left marked as busy (voicing included). NOTHING_RUNNING when nothing is running; a finished session is left as it is. Instant. " + FREE_NOTE,
  inputSchema: { id: AMBIENT_ID.describe("The session id.") },
  routes: ["/api/ambient"],
  async handler(ctx, { id }) {
    const { project, body } = await readSession(ctx, id);
    // Cancelling marks the session failed, so an idle or finished one is left alone.
    if (!AMBIENT_BUSY.includes(project.status)) {
      return fail("NOTHING_RUNNING", "Nothing is running on this session (no voicing, pictures or render).");
    }
    // The voicing stage does not stop for a cancel: it would write its verses back over it, after spending the tts.
    if (project.status === "voicing" && !body.interrupted) {
      return fail("VOICING_CANNOT_CANCEL", "Voicing cannot be stopped; it finishes on its own in a few seconds per verse. Wait for it with jobs_wait (kind ambient).");
    }
    await ctx.api.call("POST", `${projectPath(id)}/cancel`);
    return ok({ kind: "ambient", id, cancelled: true });
  },
};

export default [ambientProject, ambientPlan, ambientStep, ambientUpdate, ambientRender, ambientCancel];
