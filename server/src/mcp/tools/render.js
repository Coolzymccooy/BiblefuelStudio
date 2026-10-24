import { z } from "zod";
import { ok, fail } from "../toolResult.js";
import { NORMALISERS, outputUrl } from "../jobs.js";
import { resolveMediaInput } from "../mediaPath.js";
import { renderPublishPlan } from "../autoPublish.js";
import { VOICE_ID_PATTERN } from "./voice.js";

// A library item id (pexels_123, agent_<uuid>): no dots, slashes or colons, so
// it can never also name a file next to the server. It must be in the user's
// own library, checked before the route resolves it.
const LIBRARY_ID = /^[A-Za-z0-9][\w-]{0,119}$/;
const IMAGE_FILE = /\.(png|jpe?g|webp)$/i;
const STYLE_WORD = /^[\w-]{1,40}$/;
const ASPECTS = ["portrait", "landscape", "square"];
const DEFAULT_SHORT_SEC = 20;
const MIN_SCENE_SEC = 0.5;
// autoBackground picks up to 4 clips and AI-generates any the library cannot supply.
const AUTO_BACKGROUND_IMAGES = 4;
const MAX_SHORT_BACKGROUNDS = 10;
const MAX_CAPTIONED_BACKGROUNDS = 30;

/** A copy of `fields` without undefined values, so the route's own defaults apply. */
function defined(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

async function libraryIds(ctx, values) {
  if (!values.some((value) => LIBRARY_ID.test(value))) return new Set();
  const body = await ctx.api.call("GET", "/api/library");
  const items = Array.isArray(body?.library?.items) ? body.library.items : [];
  return new Set(items.map((item) => String(item?.id)));
}

/** One background as the route takes it: a library id from the user's library, or a confined real path. */
async function resolveBackground(ctx, value, inLibrary, index) {
  const raw = String(value).trim();
  if (inLibrary.has(raw)) return { ref: raw, kind: "video" };
  if (LIBRARY_ID.test(raw)) {
    return {
      refusal: fail(
        "BACKGROUND_NOT_FOUND",
        `Background ${index + 1} ("${raw}") is not in your library. Use an id from library_items (download a backgrounds_search result first) or a file in your media folder.`,
      ),
    };
  }
  const checked = await resolveMediaInput(ctx, raw);
  if (checked.refusal) return checked;
  return { ref: checked.path, kind: IMAGE_FILE.test(checked.path) ? "image" : "video" };
}

/** Every background resolved in order, or the first refusal. */
async function resolveBackgrounds(ctx, values = []) {
  const inLibrary = await libraryIds(ctx, values);
  const resolved = [];
  for (const [index, value] of values.entries()) {
    const one = await resolveBackground(ctx, value, inLibrary, index);
    if (one.refusal) return { refusal: one.refusal };
    resolved.push(one);
  }
  return { backgrounds: resolved };
}

/** An optional media path (or, with allowRefs, a library:/mylib: music ref), confined; undefined stays undefined. */
async function optionalMedia(ctx, value, options) {
  if (value === undefined) return { path: undefined };
  return resolveMediaInput(ctx, value, options);
}

// ---- render_short ------------------------------------------------------------

function sceneFields(backgrounds, durationSec) {
  if (backgrounds.length === 1) return { backgroundPath: backgrounds[0].ref };
  const duration = Math.max(MIN_SCENE_SEC, (durationSec ?? DEFAULT_SHORT_SEC) / backgrounds.length);
  return { scenes: backgrounds.map((b) => ({ backgroundPath: b.ref, duration, kind: b.kind })) };
}

function shortProblem({ backgrounds, autoBackground }) {
  const hasBackgrounds = Array.isArray(backgrounds) && backgrounds.length > 0;
  if (hasBackgrounds && autoBackground) return "Pass backgrounds or autoBackground: true, not both.";
  if (!hasBackgrounds && !autoBackground) return "render_short needs backgrounds (library ids or media files) or autoBackground: true.";
  return null;
}

/** The enqueue payload, or a refusal when a path is not the user's. */
async function shortPayload(ctx, input) {
  const picked = await resolveBackgrounds(ctx, input.backgrounds || []);
  if (picked.refusal) return picked;
  const audio = await optionalMedia(ctx, input.audioPath);
  if (audio.refusal) return audio;
  const music = await optionalMedia(ctx, input.musicPath, { allowRefs: true });
  if (music.refusal) return music;
  const backgroundFields = input.autoBackground ? { autoBackground: true } : sceneFields(picked.backgrounds, input.durationSec);
  const { lines, durationSec, aspect, musicVolume, autoDuck, typographyPreset, kenBurns, kineticCaptions, voiceId, title, caption } = input;
  return {
    payload: defined({
      ...backgroundFields,
      lines,
      audioPath: audio.path,
      musicPath: music.path,
      durationSec, aspect, musicVolume, autoDuck, typographyPreset, kenBurns, kineticCaptions,
      voiceId: kineticCaptions ? voiceId : undefined,
      title, caption,
    }),
  };
}

const renderShort = {
  name: "render_short",
  title: "Render a short video",
  description:
    "Queue a short captioned video (Studio Render): your lines as captions over background videos or pictures, with an optional voice track and music bed. " +
    "Needs lines and EITHER backgrounds (library ids from library_items, or video/picture files in your media folder; several play one after another) OR autoBackground: true (the server picks clips from your library by mood and AI-generates any it cannot find). " +
    "audioPath is a voice file (from voice_synthesize or your media folder); musicPath is a music_library ref or a media file. URLs and paths outside your media folder are refused. " +
    "Returns a job handle of kind job: call jobs_wait with kind job and the id; the finished video's path is what publish_youtube and publish_post take. " +
    "Costs one daily render (plus four daily images with autoBackground, for possible AI pictures), charged together. Videos are capped at the server's maximum length (30 seconds by default). Takes about one to three minutes. " +
    "If the user has turned on auto-publish in Settings, a finished render is posted automatically only when this key may publish and auto-publish is on when you call this; then it also costs one daily publish. Otherwise the render is queued with auto-publish off and never posts. " +
    "autoPublish in the result says which: suppressed (no publish consent), off (auto-publish is off) or on.",
  inputSchema: {
    lines: z.array(z.string().trim().min(1).max(280)).min(1).max(12).describe("The caption lines, in order (for example hook, verse, reflection, call to action). 1 to 12."),
    backgrounds: z.array(z.string().trim().min(1).max(1000)).min(1).max(MAX_SHORT_BACKGROUNDS).optional().describe("Library ids (from library_items) or files in your media folder; 1 to 10, shown in turn. Omit with autoBackground."),
    autoBackground: z.boolean().optional().describe("true: let the server choose backgrounds from your library (AI-generating any it lacks). Omit backgrounds then."),
    audioPath: z.string().max(1000).optional().describe("A voice track in your media folder, for example the path voice_synthesize returned."),
    musicPath: z.string().max(1000).optional().describe("A music bed: a ref from music_library (library:... or mylib:...) or a file in your media folder."),
    musicVolume: z.number().min(0).max(1).optional().describe("Music volume, 0 to 1."),
    autoDuck: z.boolean().optional().describe("Lower the music under the voice."),
    durationSec: z.number().min(1).max(600).optional().describe("Video length in seconds (default 20); the server caps it at its maximum."),
    aspect: z.enum(ASPECTS).optional().describe("portrait (default, 1080x1920), landscape or square."),
    typographyPreset: z.string().regex(STYLE_WORD).optional().describe("A caption style name, for example default."),
    kenBurns: z.boolean().optional().describe("Slow zoom on still pictures."),
    kineticCaptions: z.boolean().optional().describe("Word-by-word captions. Without audioPath the server speaks the lines itself (with voiceId if given)."),
    voiceId: z.string().max(100).regex(VOICE_ID_PATTERN, "voiceId must be a voice name or a cb:... cloned voice id, never a file path").optional().describe("With kineticCaptions and no audioPath: a voice from voice_list."),
    title: z.string().trim().max(100).optional().describe("A title, used if auto-publish posts the video."),
    caption: z.string().trim().max(1900).optional().describe("The post text if auto-publish posts the video (default: the lines)."),
  },
  routes: ["/api/jobs", "/api/library"],
  async handler(ctx, input) {
    const problem = shortProblem(input);
    if (problem) return fail("BAD_INPUT", problem);
    const built = await shortPayload(ctx, input);
    if (built.refusal) return built.refusal;
    const plan = await renderPublishPlan(ctx);
    // One atomic charge (R31): a refused publish or image leaves no render spent.
    const refused = await ctx.chargeCap({
      renders: 1,
      ...(input.autoBackground ? { images: AUTO_BACKGROUND_IMAGES } : {}),
      ...plan.charge,
    });
    if (refused) return refused;
    const response = await ctx.api.call("POST", "/api/jobs/enqueue", {
      body: { type: "render_video", payload: built.payload, ...(plan.suppress ? { autoPublish: false } : {}) },
    });
    const handle = NORMALISERS.job.normalise({ job: response?.job }, { outputUrl: (p) => outputUrl(p, ctx.publicBase) });
    return ok({ ...handle, autoPublish: plan.state });
  },
};

// ---- render_captioned --------------------------------------------------------

function captionedProblem({ videoPath, audioPath, backgrounds, words, captions }) {
  const audioMode = Boolean(audioPath) || (Array.isArray(backgrounds) && backgrounds.length > 0);
  if (videoPath && audioMode) return "Pass videoPath alone, or audioPath with backgrounds, not both.";
  if (!videoPath && !(audioPath && backgrounds?.length)) return "render_captioned needs videoPath, or audioPath together with backgrounds.";
  if (captions !== false && !(Array.isArray(words) && words.length > 0)) return "words are required unless captions is false (use the words transcribe returns).";
  return null;
}

/** The route body's file fields, confined, or a refusal. */
async function captionedFiles(ctx, { videoPath, audioPath, backgrounds, musicPaths }) {
  const video = await optionalMedia(ctx, videoPath);
  if (video.refusal) return video;
  const audio = await optionalMedia(ctx, audioPath);
  if (audio.refusal) return audio;
  const picked = await resolveBackgrounds(ctx, backgrounds || []);
  if (picked.refusal) return picked;
  const music = [];
  for (const track of musicPaths || []) {
    const checked = await resolveMediaInput(ctx, track, { allowRefs: true });
    if (checked.refusal) return checked;
    music.push(checked.path);
  }
  return {
    files: defined({
      videoPath: video.path,
      audioPath: audio.path,
      backgroundPaths: picked.backgrounds.length ? picked.backgrounds.map((b) => b.ref) : undefined,
      musicPaths: music.length ? music : undefined,
    }),
  };
}

const wordSchema = z.object({
  text: z.string().max(200),
  startMs: z.number().min(0),
  endMs: z.number().min(0),
  emphasize: z.boolean().optional(),
});

const renderCaptioned = {
  name: "render_captioned",
  title: "Render a captioned video",
  description:
    "Burn word-by-word captions onto a video (Timeline render). Two modes: videoPath (a video in your media folder) OR audioPath plus backgrounds (library ids or media files, up to 30, shown in turn). " +
    "words are the timed words transcribe returns ({ text, startMs, endMs }); required unless captions is false. Paths outside your media folder and URLs are refused. " +
    "Optional: musicPaths (music_library refs or media files), musicVolume, autoDuck, startSec and durationSec (a trim window), typographyPreset, layout, depth, kenBurns, syncBackgrounds. " +
    "Returns a handle of kind captioned: call jobs_wait with kind captioned and the id; render_cancel stops it. Costs one daily render and one unit of the plan's render quota. Takes a few seconds to start and about real time to finish. It never posts anywhere.",
  inputSchema: {
    videoPath: z.string().max(1000).optional().describe("Video mode: a video in your media folder."),
    audioPath: z.string().max(1000).optional().describe("Audio mode: a voice or audio file in your media folder."),
    backgrounds: z.array(z.string().trim().min(1).max(1000)).min(1).max(MAX_CAPTIONED_BACKGROUNDS).optional().describe("Audio mode: library ids or media files, 1 to 30."),
    words: z.array(wordSchema).max(20000).optional().describe("Timed words from transcribe: { text, startMs, endMs }."),
    captions: z.boolean().optional().describe("false renders no captions (then words are not needed). Default true."),
    musicPaths: z.array(z.string().max(1000)).max(5).optional().describe("Music beds played one after another: music_library refs or media files."),
    musicVolume: z.number().min(0).max(1).optional().describe("Music volume, 0 to 1."),
    autoDuck: z.boolean().optional().describe("Lower the music under the voice."),
    startSec: z.number().min(0).optional().describe("Start this many seconds into the source."),
    durationSec: z.number().min(1).optional().describe("Render at most this many seconds."),
    typographyPreset: z.string().regex(STYLE_WORD).optional().describe("A caption style name, for example default."),
    layout: z.string().regex(STYLE_WORD).optional().describe("Caption position, for example center (default)."),
    depth: z.boolean().optional().describe("Draw the captions with depth."),
    kenBurns: z.boolean().optional().describe("Slow zoom on still pictures."),
    syncBackgrounds: z.boolean().optional().describe("Cut between several backgrounds at spoken phrases instead of equal slots."),
  },
  routes: ["/api/render", "/api/library"],
  caps: { renders: 1 },
  async handler(ctx, input) {
    const problem = captionedProblem(input);
    if (problem) return fail("BAD_INPUT", problem);
    const checked = await captionedFiles(ctx, input);
    if (checked.refusal) return checked.refusal;
    const { words, captions, musicVolume, autoDuck, startSec, durationSec, typographyPreset, layout, depth, kenBurns, syncBackgrounds } = input;
    const body = defined({
      ...checked.files,
      words, captions, musicVolume, autoDuck, startSec, durationSec, typographyPreset, layout, depth, kenBurns, syncBackgrounds,
    });
    const response = await ctx.api.call("POST", "/api/render/captioned-video", { body });
    const handle = NORMALISERS.captioned.normalise({ jobId: response?.jobId, status: "running" }, { outputUrl: (p) => outputUrl(p, ctx.publicBase) });
    return ok({ ...handle, durationSec: response?.durationSec ?? null });
  },
};

// ---- render_cancel -----------------------------------------------------------

const renderCancel = {
  name: "render_cancel",
  title: "Cancel a captioned render",
  description:
    "Stop a running render_captioned job by its id. A finished render cannot be cancelled (an error says so). " +
    "Queued render_short jobs (kind job) have no cancel. Free and instant.",
  inputSchema: { id: z.string().min(1).max(200).describe("The id render_captioned returned.") },
  routes: ["/api/render"],
  async handler(ctx, { id }) {
    await ctx.api.call("POST", `/api/render/captioned-video/${encodeURIComponent(id)}/cancel`);
    return ok({ kind: "captioned", id, status: "cancelled" });
  },
};

export default [renderShort, renderCaptioned, renderCancel];
