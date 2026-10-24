import { z } from "zod";
import { ok, fail, withoutOk } from "../toolResult.js";
import { outputUrl } from "../jobs.js";
import { resolveMediaInput } from "../mediaPath.js";

const SYNTH_PROVIDERS = ["auto", "elevenlabs", "edge", "azure", "chatterbox", "fish", "piper"];
const LIST_PROVIDERS = ["edge", "elevenlabs"];
const CLONE_PROVIDERS = ["elevenlabs", "chatterbox"];
const TRANSCRIPT_ACTIONS = ["list", "add", "remove"];
const TRANSCRIPT_LIST_LIMIT = 50;

// A voiceId must never become a file path. Chatterbox reads its voiceId as a
// reference-audio path on the bridge, and "auto" can fall through to
// Chatterbox, so a voice id is either a saved-clone alias (cb:<id>) or a plain
// voice name: letters, digits, - and _, no dots, slashes, colons or spaces.
const CLONE_ALIAS = /^cb:[\w-]+$/;
const VOICE_NAME = /^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/;
export const VOICE_ID_PATTERN = new RegExp(`${CLONE_ALIAS.source}|${VOICE_NAME.source}`);

/** An error message when voiceId is not acceptable for this provider, else null. */
function voiceIdProblem(provider, voiceId) {
  if (voiceId === undefined || voiceId === "") return null;
  if (provider === "chatterbox") {
    return CLONE_ALIAS.test(voiceId) ? null : "With provider chatterbox, voiceId must be a cloned voice id from voice_list (cb:...), or left out.";
  }
  if (CLONE_ALIAS.test(voiceId)) return "A cloned voice (cb:...) only works with provider chatterbox. Set provider chatterbox.";
  return VOICE_NAME.test(voiceId) ? null : "voiceId must be a voice name from voice_list (letters, digits, - and _), never a file path.";
}

/** A copy of `fields` without undefined values, so the route's own defaults apply. */
function defined(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

const isApiError = (err) => err?.name === "ApiError";

// ---- voice_list -------------------------------------------------------------

/** The voice catalogue for one provider, or the reason it is unavailable (a premium lock, a missing key, Edge off). */
async function voicesFor(ctx, provider) {
  try {
    const body = await ctx.api.call("GET", "/api/tts/voices", { query: { provider } });
    return { voices: Array.isArray(body?.voices) ? body.voices : [] };
  } catch (err) {
    if (!isApiError(err)) throw err;
    return { voices: [], voicesError: err.message };
  }
}

const withoutRefPath = ({ refPath: _refPath, ...voice }) => voice;

// A language tag such as en or en-GB: letters, then dash-separated parts.
const LOCALE_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

/**
 * The voices of one language. A voice without a locale (ElevenLabs lists none) is kept,
 * since its language cannot be told. Prefix match on whole tag parts: en keeps en-GB, not eno.
 */
function voicesOfLocale(voices, locale) {
  if (!locale) return voices;
  const wanted = locale.toLowerCase();
  return voices.filter((voice) => {
    if (typeof voice?.locale !== "string" || !voice.locale) return true;
    const tag = voice.locale.toLowerCase();
    return tag === wanted || tag.startsWith(`${wanted}-`);
  });
}

const voiceList = {
  name: "voice_list",
  title: "List voices, providers and voice profiles",
  description:
    "Everything needed to choose a voice, in one result: voices (the catalogue of one provider), providers (an object keyed by speech provider id, each with available, priority and a reason when it is not configured here), " +
    "profiles (the app's voice categories, such as devotional, and the provider each prefers) and clonedVoices (voices you cloned on Chatterbox; use their id as voiceId with provider chatterbox). " +
    "provider picks which catalogue to list: edge (free, default) or elevenlabs (premium plans only). " +
    "If that catalogue is unavailable the rest still comes back, with voicesError saying why. Free and instant. " +
    "Pass locale (for example en or en-GB) to list only that language's voices: without it the edge catalogue is over 300 voices (about 100 KB), which many clients cut off. totalVoices counts the whole catalogue. " +
    "providers says which speech providers work here: when one fails, pick another whose available is true. " +
    "Next: voice_synthesize with a voice's voice_id.",
  inputSchema: {
    provider: z.enum(LIST_PROVIDERS).optional().describe("Whose voices to list: edge (default) or elevenlabs (needs a premium plan)."),
    locale: z.string().max(20).regex(LOCALE_TAG, "locale must be a language tag such as en or en-GB").optional().describe("Edge voices only: just voices of this language, for example en (every English voice) or en-GB. Recommended: the full edge list is over 300 voices. ElevenLabs voices carry no language tag, so they are all listed."),
    probe: z.boolean().optional().describe("Also check that self-hosted providers (Chatterbox) are reachable right now. Adds up to 5 seconds. Default false."),
  },
  routes: ["/api/tts"],
  async handler(ctx, { provider = "edge", probe, locale }) {
    const [catalogue, providers, profiles, cloned] = await Promise.all([
      voicesFor(ctx, provider),
      ctx.api.call("GET", "/api/tts/providers", probe ? { query: { probe: 1 } } : {}),
      ctx.api.call("GET", "/api/tts/profiles"),
      ctx.api.call("GET", "/api/tts/chatterbox-voices").catch((err) => {
        if (isApiError(err)) return { voices: [] };
        throw err;
      }),
    ]);
    return ok({
      provider,
      ...(locale ? { locale } : {}),
      ...catalogue,
      voices: voicesOfLocale(catalogue.voices, locale),
      totalVoices: catalogue.voices.length,
      providers: providers?.providers && typeof providers.providers === "object" ? providers.providers : {},
      profiles: Array.isArray(profiles?.profiles) ? profiles.profiles : [],
      clonedVoices: (Array.isArray(cloned?.voices) ? cloned.voices : []).map(withoutRefPath),
    });
  },
};

// ---- voice_synthesize -------------------------------------------------------

/** The request body each provider's route reads. Options a provider does not read are left out. */
const SYNTH_BODY = {
  auto: ({ text, voiceId }) => ({ text, voiceId }),
  elevenlabs: ({ text, voiceId, modelId }) => ({ text, voiceId, modelId }),
  edge: ({ text, voiceId, rate, pitch, volume }) => ({ text, voiceId, rate, pitch, volume }),
  azure: ({ text, voiceId, withTimestamps }) => ({ text, voiceId, withTimestamps }),
  chatterbox: ({ text, voiceId, exaggeration, cfgWeight }) => ({ text, voiceId, exaggeration, cfgWeight }),
  fish: ({ text, voiceId, speed, withTimestamps, modelId }) => ({ text, voiceId, speed, withTimestamps, modelId }),
  piper: ({ text, voiceId, withTimestamps }) => ({ text, voiceId, withTimestamps }),
};

const voiceSynthesize = {
  name: "voice_synthesize",
  title: "Turn text into speech",
  description:
    "Speak text and save it as an audio file in the server's output folder. Returns path (pass it to audio_process, transcribe or a render tool) and url (playable), " +
    "plus provider and voice for what really ran, and words (start and end times) when withTimestamps was set on azure, fish or piper. " +
    "provider auto (default) uses ElevenLabs on premium plans, falling back to Edge-TTS if it fails. On a free plan auto is Edge-TTS alone, with no fallback: " +
    "if it fails (HTTP_502), force another provider that voice_list shows as available, such as azure (not elevenlabs or fish, which a free plan cannot use even when available). " +
    "the other values force one provider: elevenlabs and fish need a premium plan (FEATURE_LOCKED otherwise), chatterbox needs its bridge, piper needs PIPER_URL, azure needs a key. " +
    "A forced provider can still fall back; check fallbackProvider in the result. " +
    "voiceId comes from voice_list. Options, each read only by its own provider and ignored with auto: rate, pitch, volume for edge; exaggeration and cfgWeight for chatterbox; speed for fish; withTimestamps for azure, fish and piper; modelId for elevenlabs and fish. " +
    "Each call spends one of the agent's daily tts calls and one of the plan's daily tts quota, and takes a few seconds.",
  inputSchema: {
    text: z.string().min(3).max(5000).describe("What to say, 3 to 5000 characters. Plain text; markup and emoji are stripped."),
    voiceId: z.string().max(100).regex(VOICE_ID_PATTERN, "voiceId must be a voice name or a cb:... cloned voice id, never a file path").optional().describe("A voice id from voice_list (voice_id; a cb:... cloned voice only with provider chatterbox). Never a file path. Omit for the provider's default."),
    provider: z.enum(SYNTH_PROVIDERS).optional().describe("auto (default), elevenlabs, edge, azure, chatterbox, fish or piper."),
    rate: z.string().max(20).optional().describe("Edge only (provider edge; ignored with auto): speaking rate, for example +10% or -20%."),
    pitch: z.string().max(20).optional().describe("Edge only: pitch, for example +2Hz or -5Hz."),
    volume: z.string().max(20).optional().describe("Edge only: volume, for example +10%."),
    exaggeration: z.number().min(0).max(2).optional().describe("Chatterbox only: how expressive the delivery is."),
    cfgWeight: z.number().min(0).max(2).optional().describe("Chatterbox only: how closely it follows the reference voice."),
    speed: z.number().min(0.5).max(2).optional().describe("Fish only: speaking speed from 0.5 to 2."),
    withTimestamps: z.boolean().optional().describe("Azure, fish and piper: also return word timings in words."),
    modelId: z.string().max(100).optional().describe("ElevenLabs and fish: a model id, if you need a specific one."),
  },
  routes: ["/api/tts"],
  caps: { tts: 1 },
  async handler(ctx, input) {
    const provider = input.provider || "auto";
    const problem = voiceIdProblem(provider, input.voiceId);
    if (problem) return fail("BAD_INPUT", problem);
    const body = await ctx.api.call("POST", `/api/tts/${provider}`, { body: defined(SYNTH_BODY[provider](input)) });
    const { file, ...rest } = withoutOk(body);
    if (!file) return fail("NO_AUDIO", "The voice provider answered without an audio file. Try again or choose another provider.");
    return ok({ ...rest, path: file, url: outputUrl(file, ctx.publicBase) });
  },
};

// ---- voice_clone ------------------------------------------------------------

const voiceClone = {
  name: "voice_clone",
  title: "Clone a voice from audio samples",
  description:
    "Create a custom voice from recordings in your media folder (paths from media_list or media_import_url; anything outside it is refused with PATH_OUTSIDE_MEDIA). " +
    "Premium plans only (FEATURE_LOCKED otherwise). provider elevenlabs (default) builds a voice in your ElevenLabs account from all the samples; " +
    "chatterbox saves the first sample as a reference and returns voiceId cb:..., which you pass to voice_synthesize with provider chatterbox. " +
    "Samples must be mp3, wav, m4a, aac, ogg, flac or webm and at least 2 KB. " +
    "consent is required: set all three flags to true ONLY after the key's owner has told you they have the right to use the recorded voice, that it is not an impersonation of someone else, and that they accept the provider's terms. " +
    "Counts as one daily tts call and takes a few seconds.",
  inputSchema: {
    name: z.string().min(2).max(100).describe("A name for the new voice, at least 2 characters."),
    samplePaths: z.array(z.string().min(1)).min(1).max(25).describe("Server-local paths of the voice recordings, from media_list or media_import_url. 1 to 25."),
    provider: z.enum(CLONE_PROVIDERS).optional().describe("elevenlabs (default) or chatterbox."),
    description: z.string().max(300).optional().describe("A short description of the voice."),
    removeBackgroundNoise: z.boolean().optional().describe("ElevenLabs only: clean the samples first. Default true."),
    consent: z
      .object({
        hasRights: z.literal(true).describe("The owner has the rights to, or permission for, this voice."),
        noImpersonation: z.literal(true).describe("The voice will not be used to impersonate anyone."),
        termsAccepted: z.literal(true).describe("The owner accepts the provider's terms."),
      })
      .describe("All three must be true, and only after the owner has said so."),
  },
  routes: ["/api/tts"],
  caps: { tts: 1 },
  async handler(ctx, { name, samplePaths, provider, description, removeBackgroundNoise, consent }) {
    const resolved = [];
    for (const sample of samplePaths) {
      const checked = await resolveMediaInput(ctx, sample);
      if (checked.refusal) return checked.refusal;
      resolved.push(checked.path);
    }
    const body = defined({ provider, name, description, samplePaths: resolved, removeBackgroundNoise, consent });
    const result = withoutOk(await ctx.api.call("POST", "/api/tts/clone-voice", { body }));
    return ok({ ...result, ...(result.voice ? { voice: withoutRefPath(result.voice) } : {}) });
  },
};

// ---- transcripts ------------------------------------------------------------

const wordSchema = z.object({ text: z.string(), startMs: z.number(), endMs: z.number() }).passthrough();

/** A saved transcript as the agent sees it: no owner id. */
function publicTranscript({ userId: _userId, ...item }) {
  return item;
}

function transcriptSummary(item) {
  const { words, userId: _userId, ...rest } = item;
  return { ...rest, wordCount: Array.isArray(words) ? words.length : 0 };
}

async function listTranscripts(ctx, { id, limit }) {
  const body = await ctx.api.call("GET", "/api/transcripts", { query: { limit: limit ?? TRANSCRIPT_LIST_LIMIT } });
  const items = Array.isArray(body?.items) ? body.items : [];
  if (!id) return ok({ items: items.map(transcriptSummary) });
  const found = items.find((item) => item?.id === id);
  return found ? ok({ item: publicTranscript(found) }) : fail("NOT_FOUND", `No saved transcript with id ${id}.`);
}

async function addTranscript(ctx, input) {
  const { sourceFile, words, editedLines, typographyPreset, durationSec } = input;
  if (!sourceFile || !Array.isArray(words) || !Array.isArray(editedLines)) {
    return fail("BAD_INPUT", "add needs sourceFile, words and editedLines.");
  }
  const body = defined({ sourceFile, words, editedLines, typographyPreset, durationSec });
  const result = await ctx.api.call("POST", "/api/transcripts", { body });
  return ok({ item: transcriptSummary(result?.item || {}) });
}

async function removeTranscript(ctx, { id }) {
  if (!id) return fail("BAD_INPUT", "remove needs the transcript id.");
  const result = await ctx.api.call("DELETE", `/api/transcripts/${encodeURIComponent(id)}`);
  return ok({ removed: Boolean(result?.removed) });
}

const TRANSCRIPT_HANDLERS = { list: listTranscripts, add: addTranscript, remove: removeTranscript };

const transcripts = {
  name: "transcripts",
  title: "Saved transcripts",
  description:
    "Your saved, edited transcripts (the Voice and audio page keeps up to 50). " +
    "action list: summaries (id, sourceFile, label, editedLines, wordCount, durationSec); pass id to get one in full with its words. limit is 1 to 50. " +
    "action add: save or update the transcript for a source file; sourceFile, words (from the transcribe tool: text, startMs, endMs) and editedLines (your cleaned-up caption lines) are required. " +
    "Saving again for the same file name updates it. " +
    "action remove: delete the transcript with the given id; returns { removed }. Free and instant.",
  inputSchema: {
    action: z.enum(TRANSCRIPT_ACTIONS).describe("list, add or remove."),
    id: z.string().max(100).optional().describe("list: return only this transcript, in full. remove: the transcript to delete."),
    limit: z.number().int().min(1).max(TRANSCRIPT_LIST_LIMIT).optional().describe("list: how many to return, 1 to 50."),
    sourceFile: z.string().max(500).optional().describe("add: the audio or video file the transcript is for; only its file name is kept."),
    words: z.array(wordSchema).max(50000).optional().describe("add: the words, each with text, startMs and endMs, as transcribe returns them."),
    editedLines: z.array(z.string().max(1000)).max(5000).optional().describe("add: the caption lines after editing."),
    typographyPreset: z.string().max(100).optional().describe("add: the caption style preset, if one was chosen."),
    durationSec: z.number().min(0).optional().describe("add: the media length in seconds."),
  },
  routes: ["/api/transcripts"],
  async handler(ctx, input) {
    return TRANSCRIPT_HANDLERS[input.action](ctx, input);
  },
};

export default [voiceList, voiceSynthesize, voiceClone, transcripts];
