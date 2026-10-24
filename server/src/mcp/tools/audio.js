import { z } from "zod";
import { ok, fail, withoutOk } from "../toolResult.js";
import { outputUrl } from "../jobs.js";
import { resolveMediaInput } from "../mediaPath.js";

const PRESETS = ["raw", "clean_voice", "podcast", "warm"];
const ADVANCED_ACTIONS = ["merge", "timeline", "timeline_preview", "info"];

/** A copy of `fields` without undefined values, so the route's own defaults apply. */
function defined(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

/** The answer for a tool that wrote one file: path and url first, then the named extra fields the route returned. */
function fileResult(ctx, body, extraKeys) {
  const data = withoutOk(body);
  if (!data.file) return fail("NO_OUTPUT", "The audio step finished without writing a file. Try again.");
  const extras = Object.fromEntries(extraKeys.filter((key) => data[key] !== undefined).map((key) => [key, data[key]]));
  return ok({ path: data.file, url: outputUrl(data.file, ctx.publicBase), ...extras });
}

// ---- audio_process ----------------------------------------------------------

const processSchema = {
  inputPath: z.string().min(1).describe("Server-local path of the audio file, from media_list, media_import_url or a voice_synthesize result."),
  preset: z.enum(PRESETS).optional().describe("Starting point: clean_voice (default), podcast, warm or raw (no processing unless you set options below)."),
  trim: z.object({ startSec: z.number().min(0).optional(), durationSec: z.number().min(0.1).optional() }).optional().describe("Keep only this part: where to start and how long, in seconds."),
  normalize: z.object({ targetLUFS: z.number().min(-70).max(-5) }).optional().describe("Loudness target in LUFS, for example -16."),
  denoise: z.object({ strength: z.number().min(0).max(1) }).optional().describe("Noise reduction, 0 to 1."),
  gate: z.object({ thresholdDb: z.number().min(-80).max(0) }).optional().describe("Noise gate threshold in dB, for example -38."),
  eq: z.object({ highpassHz: z.number().min(20).max(2000).optional(), lowpassHz: z.number().min(1000).max(20000).optional() }).optional().describe("Cut rumble below highpassHz and hiss above lowpassHz."),
  compressor: z
    .object({
      ratio: z.number().min(1).max(20).optional(),
      thresholdDb: z.number().min(-60).max(0).optional(),
      attackMs: z.number().min(0).max(2000).optional(),
      releaseMs: z.number().min(0).max(5000).optional(),
    })
    .optional()
    .describe("Even out loud and quiet parts."),
  silenceRemove: z.object({ enabled: z.boolean() }).optional().describe("Trim silence from the start."),
  deesser: z.object({ amount: z.number().min(0).max(1) }).optional().describe("Soften harsh s sounds, 0 to 1."),
  limiter: z.object({ ceilingDb: z.number().min(-20).max(0) }).optional().describe("Peak ceiling in dB, for example -1."),
  presence: z
    .object({ freqHz: z.number().min(100).max(16000).optional(), gainDb: z.number().min(-20).max(20), widthQ: z.number().min(0.1).max(10).optional() })
    .optional()
    .describe("Lift or dip one frequency band to add or remove presence."),
};

const audioProcess = {
  name: "audio_process",
  title: "Clean up an audio file",
  description:
    "Run a voice-cleanup chain on an audio file with ffmpeg and save the result as a NEW mp3; the original is kept. " +
    "Pick a preset (clean_voice is the default) and override any step: trim, loudness, noise reduction, gate, EQ, compressor, de-esser, limiter, presence. " +
    "inputPath must be in your media folder (PATH_OUTSIDE_MEDIA otherwise). " +
    "Returns path (pass it on to transcribe or a render tool), url, the settings applied and loudnormMode. " +
    "Not counted against any quota; takes a few seconds for a short voice file and longer for long recordings.",
  inputSchema: processSchema,
  routes: ["/api/audio"],
  async handler(ctx, { inputPath, ...options }) {
    const checked = await resolveMediaInput(ctx, inputPath);
    if (checked.refusal) return checked.refusal;
    const body = await ctx.api.call("POST", "/api/audio/process", { body: { inputPath: checked.path, ...defined(options) } });
    return fileResult(ctx, body, ["applied", "filterChain", "loudnormMode"]);
  },
};

// ---- audio_advanced ---------------------------------------------------------

const clipSchema = z.object({
  path: z.string().min(1).describe("A media path, or a music reference from music_library (library:... or mylib:...)."),
  startSec: z.number().min(0).optional().describe("Start this far into the clip, in seconds."),
  durationSec: z.number().min(0.1).optional().describe("Keep this many seconds of the clip."),
});

/** Resolves every clip's path under the media rule; returns the clips ready to send, or a tool error. */
async function resolveClips(ctx, clips) {
  const resolved = [];
  for (const clip of clips) {
    const checked = await resolveMediaInput(ctx, clip.path, { allowRefs: true });
    if (checked.refusal) return { refusal: checked.refusal };
    resolved.push(defined({ path: checked.path, startSec: clip.startSec, durationSec: clip.durationSec }));
  }
  return { clips: resolved };
}

async function mergeAudio(ctx, input) {
  if ((input.inputs || []).length < 2) return fail("BAD_INPUT", "merge needs inputs with at least 2 files.");
  const resolved = await resolveClips(ctx, input.inputs.map((path) => ({ path })));
  if (resolved.refusal) return resolved.refusal;
  const body = defined({ inputs: resolved.clips.map((c) => c.path), fades: input.fades, deess: input.deess, normalizeLUFS: input.normalizeLUFS });
  return fileResult(ctx, await ctx.api.call("POST", "/api/audio-adv/merge", { body }), ["filters"]);
}

async function timelineAudio(ctx, input) {
  if (!(input.clips || []).length) return fail("BAD_INPUT", "timeline needs clips with at least 1 clip.");
  const resolved = await resolveClips(ctx, input.clips);
  if (resolved.refusal) return resolved.refusal;
  const body = defined({ clips: resolved.clips, fades: input.fades, deess: input.deess, normalizeLUFS: input.normalizeLUFS });
  return fileResult(ctx, await ctx.api.call("POST", "/api/audio-adv/timeline", { body }), ["filterComplex"]);
}

async function previewTimeline(ctx, input) {
  if (!(input.clips || []).length || !input.backgroundPath) {
    return fail("BAD_INPUT", "timeline_preview needs clips and backgroundPath.");
  }
  const background = await resolveMediaInput(ctx, input.backgroundPath);
  if (background.refusal) return background.refusal;
  const resolved = await resolveClips(ctx, input.clips);
  if (resolved.refusal) return resolved.refusal;
  const body = defined({ clips: resolved.clips, backgroundPath: background.path, fades: input.fades, normalizeLUFS: input.normalizeLUFS });
  return fileResult(ctx, await ctx.api.call("POST", "/api/audio-adv/timeline-preview", { body }), []);
}

async function audioInfo(ctx, input) {
  if (!input.inputPath) return fail("BAD_INPUT", "info needs inputPath.");
  const checked = await resolveMediaInput(ctx, input.inputPath);
  if (checked.refusal) return checked.refusal;
  const body = await ctx.api.call("GET", "/api/audio-adv/info", { query: { inputPath: checked.path } });
  return ok({ durationSec: body?.durationSec ?? null });
}

const ADVANCED_HANDLERS = { merge: mergeAudio, timeline: timelineAudio, timeline_preview: previewTimeline, info: audioInfo };

const audioAdvanced = {
  name: "audio_advanced",
  title: "Merge, arrange and inspect audio",
  description:
    "Edit audio with ffmpeg; action chooses what. All files must be in your media folder (PATH_OUTSIDE_MEDIA otherwise); music tracks from music_library can be used as library:... or mylib:... references in inputs and clips. " +
    "merge: join inputs (2 to 20 files) end to end into one new mp3. " +
    "timeline: build one new mp3 from clips, each trimmed with startSec and durationSec. " +
    "timeline_preview: lay the clips over a background video (backgroundPath) as a new mp4, to check the sound against a picture. " +
    "info: read the length of inputPath in seconds. " +
    "fades (inMs, outMs), deess and normalizeLUFS apply to merge and timeline (timeline_preview takes fades and normalizeLUFS). " +
    "Returns path and url of the new file. Not counted against any quota; takes seconds for short clips, longer for long ones.",
  inputSchema: {
    action: z.enum(ADVANCED_ACTIONS).describe("merge, timeline, timeline_preview or info."),
    inputs: z.array(z.string().min(1)).max(20).optional().describe("merge: the files to join, in order."),
    clips: z.array(clipSchema).max(30).optional().describe("timeline and timeline_preview: the clips, in order."),
    backgroundPath: z.string().optional().describe("timeline_preview: the background video, a path in your media folder."),
    inputPath: z.string().optional().describe("info: the audio file to measure."),
    fades: z.object({ inMs: z.number().min(0).max(60000).optional(), outMs: z.number().min(0).max(60000).optional() }).optional().describe("Fade the whole result in and out, in milliseconds."),
    deess: z.object({ enabled: z.boolean(), amount: z.number().min(0.1).max(1).optional() }).optional().describe("merge and timeline: soften harsh s sounds."),
    normalizeLUFS: z.number().min(-70).max(-5).optional().describe("Loudness target for the result in LUFS, for example -16."),
  },
  routes: ["/api/audio-adv"],
  async handler(ctx, input) {
    return ADVANCED_HANDLERS[input.action](ctx, input);
  },
};

export default [audioProcess, audioAdvanced];
