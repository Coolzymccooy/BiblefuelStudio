import { z } from "zod";
import { ok, fail, withoutOk } from "../toolResult.js";
import { resolveMediaInput } from "../mediaPath.js";
import { renderQuotaRefusal } from "../planQuota.js";
import { CAPTION_MODES, STORY_ID, SCENE_ID, projectView, startedHandle } from "../storyView.js";

const STYLE_WORD = /^[\w-]{1,40}$/;
// Float drift (1.1 * 100 is 110.00000000000001) must not round a cent up.
const CENT_EPSILON = 1e-9;

const projectPath = (id) => `/api/story/${encodeURIComponent(id)}`;
const scenePath = (id, sceneId) => `${projectPath(id)}/scenes/${encodeURIComponent(sceneId)}`;

function defined(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

const viewOf = (ctx, body) => projectView(body?.project || {}, ctx.publicBase);

// ---- story_scene_update ------------------------------------------------------

/** One new picture for the scene (the plan quota already checked): one daily image, given back when none was made. */
async function regenerate(ctx, id, sceneId) {
  const refused = await ctx.chargeCap({ images: 1 });
  if (refused) return { refusal: refused };
  const body = await ctx.api.call("POST", `${scenePath(id, sceneId)}/regenerate`);
  if (!body?.sceneOk) await ctx.refundCap({ images: 1 });
  return { body };
}

const storySceneUpdate = {
  name: "story_scene_update",
  title: "Change one story scene",
  description:
    "Change one scene of a story project (scene ids from story_project get). prompt replaces the picture prompt (the style is still added at generation); text replaces the scene's caption text. " +
    "regenerate: true makes a new picture from the (new) prompt now and waits for it, about 10 to 60 seconds; costs one daily images, given back when the provider makes none (sceneOk false, sceneError says why). " +
    "Each change counts one unit of the plan's render quota; regenerate checks it first (QUOTA_EXCEEDED). Wait until a running images step has finished before regenerating.",
  inputSchema: {
    id: STORY_ID.describe("The project id."),
    sceneId: SCENE_ID.describe("The scene id, for example scene-001."),
    prompt: z.string().trim().min(3).max(2000).optional().describe("A new picture prompt for the scene."),
    text: z.string().trim().min(1).max(2000).optional().describe("New caption text for the scene."),
    regenerate: z.boolean().optional().describe("true: make a new picture for the scene now (one daily images)."),
  },
  routes: ["/api/story"],
  async handler(ctx, { id, sceneId, prompt, text, regenerate: remake }) {
    if (prompt === undefined && text === undefined && !remake) {
      return fail("BAD_INPUT", "Give prompt, text or regenerate: true.");
    }
    // Before any change, so a regenerate the plan refuses leaves the scene as it was.
    if (remake) {
      const outOfQuota = await renderQuotaRefusal(ctx);
      if (outOfQuota) return outOfQuota;
    }
    let body = null;
    if (prompt !== undefined || text !== undefined) {
      body = await ctx.api.call("PATCH", scenePath(id, sceneId), { body: defined({ imagePrompt: prompt, text }) });
    }
    if (!remake) return ok({ project: viewOf(ctx, body) });
    const made = await regenerate(ctx, id, sceneId);
    if (made.refusal) return made.refusal;
    return ok({ project: viewOf(ctx, made.body), sceneOk: Boolean(made.body?.sceneOk), sceneError: made.body?.sceneError ?? null });
  },
};

// ---- story_settings ----------------------------------------------------------

const captionsSchema = z.object({
  mode: z.enum(CAPTION_MODES).optional().describe("kinetic (word by word), static or none."),
  preset: z.string().regex(STYLE_WORD).optional().describe("A caption style name, for example default."),
  motion: z.enum(["words", "lines", "block"]).optional().describe("How captions appear."),
  layout: z.enum(["center", "center-large", "bottom-center", "bottom-left", "staggered"]).optional().describe("Where captions sit."),
  depth: z.enum(["none", "soft", "hard"]).optional().describe("Caption shadow depth."),
  stagger: z.boolean().optional().describe("Stagger the words."),
  highlight: z.boolean().optional().describe("Highlight the spoken word."),
  energy: z.enum(["calm", "lively", "wild"]).optional().describe("How much the captions move."),
  seed: z.number().int().min(0).max(2147483647).optional().describe("A choreography seed; a new one reshuffles the caption moves."),
  title: z.string().trim().max(60).optional().describe("A title card line."),
});

const musicSchema = z.object({
  path: z.string().max(1000).nullable().optional().describe("A music_library ref (library:... or mylib:...) or a file in your media folder; null removes the music."),
  volume: z.number().min(0).max(1).optional().describe("Music volume, 0 to 1 (default 0.3)."),
  autoDuck: z.boolean().optional().describe("Lower the music under the voice (default true)."),
});

function captionsBody(c) {
  return defined({
    captions: c.mode,
    captionPreset: c.preset,
    captionMotion: c.motion,
    captionLayout: c.layout,
    captionDepth: c.depth,
    captionStagger: c.stagger,
    captionHighlight: c.highlight,
    captionEnergy: c.energy,
    captionSeed: c.seed,
    captionTitle: c.title,
  });
}

/** The /music body with its path confined (refs allowed, null clears), or a refusal. */
async function musicBody(ctx, music) {
  if (music.path === undefined || music.path === null) {
    return { body: defined({ path: music.path, volume: music.volume, autoDuck: music.autoDuck }) };
  }
  const checked = await resolveMediaInput(ctx, music.path, { allowRefs: true });
  if (checked.refusal) return checked;
  return { body: defined({ path: checked.path, volume: music.volume, autoDuck: music.autoDuck }) };
}

async function applySettings(ctx, id, { captions, music, cast }) {
  const checkedMusic = music ? await musicBody(ctx, music) : null;
  if (checkedMusic?.refusal) return checkedMusic.refusal;
  let last = null;
  let castAnswer = null;
  if (captions) last = await ctx.api.call("PATCH", `${projectPath(id)}/captions`, { body: captionsBody(captions) });
  if (checkedMusic) last = await ctx.api.call("PATCH", `${projectPath(id)}/music`, { body: checkedMusic.body });
  if (cast) {
    castAnswer = await ctx.api.call("PATCH", `${projectPath(id)}/cast`, { body: { cast } });
    last = castAnswer;
  }
  return ok(defined({
    project: viewOf(ctx, last),
    rejectedCast: castAnswer ? castAnswer.rejected || [] : undefined,
    note: castAnswer?.note || undefined,
  }));
}

const storySettings = {
  name: "story_settings",
  title: "Story captions, music and cast",
  description:
    "Change a story project's settings; only the sections you give change. captions: mode (kinetic, static or none) and the caption look (preset, motion, layout, depth, stagger, highlight, energy, seed, title). " +
    "music: the music bed, a ref from music_library or a file in your media folder (other paths and URLs are refused), with volume and autoDuck; path null removes it. " +
    "cast: character keys from story_project characters (unknown ones come back in rejectedCast); pictures already made keep the old cast until regenerated. " +
    "Settings apply at the next story_render. Each section changed counts one unit of the plan's render quota. No daily cap is spent.",
  inputSchema: {
    id: STORY_ID.describe("The project id."),
    captions: captionsSchema.optional().describe("Caption mode and look."),
    music: musicSchema.optional().describe("The music bed."),
    cast: z.array(z.string().trim().min(1).max(40)).max(20).optional().describe("Character keys; replaces the cast."),
  },
  routes: ["/api/story"],
  async handler(ctx, { id, captions, music, cast }) {
    if (!captions && !music && !cast) return fail("BAD_INPUT", "Give captions, music or cast.");
    return applySettings(ctx, id, { captions, music, cast });
  },
};

// ---- story_animate -----------------------------------------------------------

const roundUpToCent = (usd) => Math.ceil(Number(usd) * 100 - CENT_EPSILON) / 100;

async function animate(ctx, { id, sceneIds, quality, estimateOnly }) {
  const estimate = withoutOk(await ctx.api.call("POST", `${projectPath(id)}/animate/estimate`, { body: defined({ sceneIds, quality }) }));
  if (estimateOnly) return ok({ estimate });
  if (!estimate.configured) return fail("NOT_CONFIGURED", "AI video is not set up on this server.");
  if (!(estimate.clips > 0)) return fail("NOTHING_TO_ANIMATE", "No scene with a finished picture to animate (scenes already animated are skipped unless you name them).");
  const usd = roundUpToCent(estimate.usd);
  const refused = await ctx.chargeCap({ aiVideoUsd: usd });
  if (refused) return refused;
  // Exactly the scenes the estimate priced, so the charge matches what is ordered.
  await ctx.api.call("POST", `${projectPath(id)}/animate`, { body: { sceneIds: estimate.sceneIds, quality: estimate.quality } });
  return ok({ ...startedHandle(id, "animating"), clips: estimate.clips, seconds: estimate.seconds, usdCharged: usd });
}

const storyAnimate = {
  name: "story_animate",
  title: "Animate story scenes with AI motion",
  description:
    "Turn finished scene pictures into short AI video clips (BytePlus Seedance), paid in dollars from the server's shared AI video balance. Super-admin keys only. " +
    "sceneIds picks scenes (default: every scene with a picture that is not animated yet; naming a scene re-rolls it); quality standard (default) or high costs more. " +
    "estimateOnly: true returns the estimate (clips, seconds, usd, the month's spend and cap) and orders nothing; call it first. " +
    "Otherwise the estimate's dollars, rounded up to the cent, are charged to the daily aiVideoUsd cap before any clip is ordered (refused with MCP_CAP_REACHED if it does not fit; BUDGET when the month's cap is reached). " +
    "The cap is charged from that estimate, so the real cost can differ a little (it is settled against the provider's own count), and the difference is neither charged nor given back. " +
    "Returns a handle of kind story: jobs_wait with kind story shows phase animating and animation counts until every clip is in, a few minutes per clip. Pictures stay where a clip fails. story_cancel with what animate stops further orders. Render afterwards with story_render.",
  inputSchema: {
    id: STORY_ID.describe("The project id."),
    sceneIds: z.array(SCENE_ID).min(1).max(500).optional().describe("Scenes to animate; default every scene not animated yet."),
    quality: z.enum(["standard", "high"]).optional().describe("standard (default, 720p) or high (1080p, dearer)."),
    estimateOnly: z.boolean().optional().describe("true: only price it."),
  },
  routes: ["/api/story"],
  requires: "super_admin",
  handler: animate,
};

export default [storySceneUpdate, storySettings, storyAnimate];
