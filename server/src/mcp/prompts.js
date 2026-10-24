import { z } from "zod";

/**
 * Canned step lists an agent can ask for (prompts/get): one user message that names the tools to call in
 * order, what to pass from one to the next, and where caps and consent stop the run. Prompts are listed to
 * every key, so they name only tools every key sees. Every tool name is written in a code span on its own
 * (`like_this`), and nothing else is, so prompts.test.js can check each against the catalogue.
 *
 * MCP prompt arguments arrive as strings, so numbers and switches are parsed from text here.
 */

const GUIDE_LINE = "If you are unsure about any step, read the resource biblefuel://guide first.";

const WAIT_LINE =
  "Every tool that starts work returns a job handle at once. Pass its kind and id (and projectId when the handle has one) " +
  "to `jobs_wait`, and call `jobs_wait` again with the same arguments while status is queued or running. A failed handle's error says what went wrong.";

const STOP_LINE =
  "Stop and tell the user, without retrying, when a call fails with MCP_CAP_REACHED (a daily agent cap: say which bucket and its resetsAt) " +
  "or QUOTA_EXCEEDED (the plan's own quota is used up; the hint says when it resets). A refused call costs nothing.";

const MAX_AMBIENT_HOURS = 10;
const DEFAULT_AMBIENT_HOURS = 2;
const SECONDS_PER_VERSE = 15 * 60;

/** The message text: the task line, the numbered steps, then the shared notes. */
function message(task, steps, notes = []) {
  const numbered = steps.map((step, i) => `${i + 1}. ${step}`);
  return [task, "", "Call these tools in this order:", ...numbered, "", ...notes, WAIT_LINE, STOP_LINE, GUIDE_LINE].join("\n");
}

const asPrompt = (text) => ({ messages: [{ role: "user", content: { type: "text", text } }] });

// ---- make_short_from_verse ---------------------------------------------------

const PUBLISH_CHECK =
  ", that they have at least 1 publishes remaining, and that key.publishAllowed is true. If publishAllowed is false, stop: publishing fails with PUBLISH_NOT_ALLOWED until " +
  "the key's owner switches on This key may publish in Settings, Connected agents";

// H1: read the user's auto-publish before anything is spent. A render it posts must not be uploaded a second time.
const PUBLISH_STATUS_STEP =
  "`social_status`, before anything is spent. If renderAutoPublish.enabled is true, the render will post the finished video by itself " +
  "to renderAutoPublish.platforms and spend the one daily publish: tell the user so, and do NOT call `publish_youtube` afterwards, " +
  "or the video is posted twice. Otherwise check youtube.connected is true; if it is not, stop and ask the user to connect YouTube in the app's Settings.";

const NO_PUBLISH_STATUS_STEP =
  "Only if whoami shows key.publishAllowed true: `social_status`. When renderAutoPublish.enabled is true the render will post the finished video " +
  "by itself and spend one daily publish, though this run is not meant to publish: ask the user before rendering.";

/**
 * The voice step. A voice id only works with its own provider (L5): with a chosen voice, find the provider whose
 * voice_list holds it and pass both; without one, provider auto picks the plan's default voice.
 */
function voiceStep(voice) {
  if (!voice) {
    return "`voice_synthesize` with { text: <the verse text> }. Keep the returned path. One daily tts. The default voice is used; `voice_list` lists others.";
  }
  return `\`voice_list\` (provider "edge" by default; "elevenlabs" on premium plans) to find the provider that lists ${JSON.stringify(voice)}. Free. ` +
    `Then \`voice_synthesize\` with { text: <the verse text>, voiceId: ${JSON.stringify(voice)}, provider: <the provider that listed it, for example "edge"> }. ` +
    "Keep the returned path. One daily tts. If no provider lists that voice, tell the user and leave voiceId out.";
}

// The stock-background route for a key with fewer than the 4 images autoBackground reserves (agent runs:
// a key with 1 image left stopped at whoami, or failed at render_short, though a saved clip would do).
const BACKGROUND_STEP =
  "Only if whoami shows fewer than 4 images remaining: `library_items` with { action: \"list\" } and use a saved clip, or `backgrounds_search` with " +
  "{ source: \"pexels\", query: <a calm scene that fits the verse> } and then `library_items` with { action: \"download\", source: \"pexels\", sourceId: <a result's id> } " +
  "(one daily imports). Keep the item's id, a library id, for the render step.";

function shortCore({ reference, voice, publish }) {
  return [
    `\`whoami\`: check that caps and accountCaps have at least 1 renders and 1 tts remaining, that quota.render is not used up${publish ? PUBLISH_CHECK : ""}. ` +
      "Four images remaining lets the render pick backgrounds itself; with fewer than 4 images, use a stock background instead (the background step).",
    publish ? PUBLISH_STATUS_STEP : NO_PUBLISH_STATUS_STEP,
    `\`bible_lookup\` with { mode: "verse", reference: ${JSON.stringify(reference)} }. Keep the verse text and its reference. Free.`,
    voiceStep(voice),
    BACKGROUND_STEP,
    "`render_short` with { lines: <the verse as caption lines of at most 280 characters each, at most 12 lines, the last one the reference>, " +
      "autoBackground: true, audioPath: <the path from the voice step> }, or with backgrounds: [<the library id from the background step>] in place of autoBackground. " +
      "One daily render (and four daily images with autoBackground), plus one plan render quota. The video is as long as the voice. It returns a handle of kind \"job\".",
    "`jobs_wait` with { kind: \"job\", id: <the handle's id> } until status is done (usually one to three minutes). output.path is the video; output.url plays it.",
  ];
}

const PUBLISH_STEPS = [
  "Only if auto-publish is off (render_short's result said autoPublish \"off\"): `publish_youtube` with { videoPath: <output.path from the render>, title: <up to 100 characters, naming the reference> }. It needs the key's publish consent " +
    "(PUBLISH_NOT_ALLOWED otherwise) and costs one daily publish. privacyStatus defaults to private: tell the user, or ask them before passing \"public\".",
  "Only if you called `publish_youtube` in the step before: `jobs_wait` with { kind: \"publish\", id: <the id publish_youtube returned> } until done. " +
    "The finished handle carries the video link. If auto-publish posted the video, skip this step and tell the user where it was posted.",
];

const NO_PUBLISH_NOTE =
  "This run does not publish. One exception: when this key may publish (whoami key.publishAllowed) and the user has auto-publish on, " +
  "the render posts the finished video by itself and also costs one daily publish (its result says autoPublish: \"on\"). " +
  "If key.publishAllowed is true, call `social_status` before rendering and, when renderAutoPublish.enabled is true, ask the user first.";

// A chapter:verse, or a bare chapter or verse number: never a voice name.
const VERSE_PART = /^\d+(?::\d+(?:-\d+)?)?$/;
const unquote = (text) => (typeof text === "string" ? text.replace(/^["']+|["']+$/g, "").trim() : text);

/**
 * Claude Code passes slash-command prompt arguments split on spaces, quotes or not, so
 * "/mcp__biblefuel__make_short_from_verse Romans 8:28" arrives as reference "Romans", voice "8:28".
 * A voice that is a verse number belongs to the reference.
 */
export function joinSplitReference({ reference, voice, publish }) {
  const ref = unquote(reference);
  const second = unquote(voice);
  if (second && VERSE_PART.test(second)) return { reference: `${ref} ${second}`, voice: undefined, publish };
  return { reference: ref, voice: second || undefined, publish };
}

const makeShortFromVerse = {
  name: "make_short_from_verse",
  title: "Make a short video from a Bible verse",
  description:
    "Step list for a short captioned video of one Bible verse: look it up, voice it, render it over backgrounds, wait. " +
    "With publish \"true\" it also uploads to YouTube, which needs the key's publish consent.",
  argsSchema: {
    reference: z.string().trim().min(1).max(80).describe("A Bible reference, for example John 3:16 or Psalm 23:1-3."),
    voice: z.string().trim().min(1).max(100).optional().describe("A voice name from voice_list. Default: the server's default voice."),
    publish: z.enum(["true", "false"]).optional().describe("\"true\" to upload the video to YouTube afterwards (needs publish consent). Default false."),
  },
  render(args) {
    const { reference, voice, publish } = joinSplitReference(args);
    const publishing = publish === "true";
    const task = `Make a short captioned video of the Bible verse ${reference}${publishing ? " and upload it to YouTube" : ""}.`;
    const steps = [...shortCore({ reference, voice, publish: publishing }), ...(publishing ? PUBLISH_STEPS : [])];
    return message(task, steps, publishing ? [] : [NO_PUBLISH_NOTE]);
  },
};

// ---- make_ambient_session ----------------------------------------------------

const HOURS = /^\d{1,2}(\.\d{1,2})?$/;
const hoursValue = (text) => (text === undefined ? DEFAULT_AMBIENT_HOURS : Number(text));

function ambientSteps({ theme, targetSec, verses }) {
  const themeArg = theme ? `, theme: ${JSON.stringify(theme)}` : "";
  return [
    `\`whoami\`: check that caps and accountCaps have at least 1 renders, ${verses} tts and ${verses} images remaining. ` +
      `About ${verses} verses will be planned (one every fifteen minutes); each costs one daily tts and one daily images (and the plan's own tts and image quotas), and the render one daily render and one plan render quota. ` +
      "With no render left, stop before spending anything. With fewer tts or images, pass a smaller count to the plan step and tell the user the rest can be added another day.",
    `\`ambient_project\` with { action: "create", title: <a short title>${themeArg}, targetSec: ${targetSec} }. Keep the session id. Free.`,
    "`ambient_plan` with { id } (add count when the caps are short). It replaces every verse. One plan scripts quota.",
    "`music_library`: choose one or more tracks for the music bed. Bundled tracks are cleared for use; the user's own uploads need a licence they record in the app. " +
      "Then `ambient_update` with { id, section: \"bed\", patch: { trackRefs: [<the tracks' ref values>] } }. UNCLEARED_TRACKS means pick bundled tracks instead.",
    "`ambient_step` with { id, step: \"voice\" }, then `jobs_wait` with { kind: \"ambient\", id } until done.",
    "`ambient_step` with { id, step: \"images\" }, then `jobs_wait` with { kind: \"ambient\", id } until done.",
    "`ambient_render` with { id }, then `jobs_wait` with { kind: \"ambient\", id }, again and again until done: a two-hour session can take an hour or more. output.path is the video.",
    "Only if a wait reports failed because the server restarted (a deploy stops long work): `ambient_cancel` with { id }, then run that step or `ambient_render` again.",
  ];
}

const makeAmbientSession = {
  name: "make_ambient_session",
  title: "Make an ambient scripture session",
  description:
    "Step list for a long, music-first scripture video: plan verses for a theme, add a music bed, voice the verses, make the pictures, render. " +
    "Never posts. Each verse costs daily tts and images, so long sessions may need several days of caps.",
  argsSchema: {
    theme: z.string().trim().min(1).max(500).optional().describe("What the session is about, for example rest and stillness."),
    hours: z
      .string()
      .trim()
      .regex(HOURS, "hours must be a number such as 2 or 1.5")
      .refine((text) => Number(text) > 0 && Number(text) <= MAX_AMBIENT_HOURS, `hours must be more than 0 and at most ${MAX_AMBIENT_HOURS}`)
      .optional()
      .describe(`The length in hours, up to ${MAX_AMBIENT_HOURS}. Default ${DEFAULT_AMBIENT_HOURS}.`),
  },
  render({ theme, hours }) {
    const length = hoursValue(hours);
    const targetSec = Math.max(60, Math.round(length * 3600));
    const verses = Math.max(1, Math.round(targetSec / SECONDS_PER_VERSE));
    const task = `Make an ambient session of ${length} hour${length === 1 ? "" : "s"}${theme ? ` on the theme ${JSON.stringify(theme)}` : ""}. It never posts anywhere.`;
    return message(task, ambientSteps({ theme, targetSec, verses }));
  },
};

// ---- make_lyric_video --------------------------------------------------------

const WEB_ADDRESS = /^https?:\/\//i;

function lyricSteps(songPath) {
  const path = JSON.stringify(songPath);
  const imports = WEB_ADDRESS.test(songPath) ? " and 1 imports" : "";
  return [
    "The lyric tools need a plan with the lyric.video feature (every current plan has it). If the lyric tools are not in your tools/list, " +
      "stop and tell the user their plan does not include lyric videos.",
    `\`whoami\`: check that caps and accountCaps have at least 2 renders${imports} remaining, and that quota.render has 2 left: timing the lyrics and rendering cost ` +
      `one daily render and one plan render quota each${imports ? ", and importing the song one daily imports" : ""}. With fewer, stop before spending anything.`,
    `The song must be a file in your own media folder. If ${path} is a public web address, import it with \`media_import_url\` with { url: ${path}, kind: "audio" } ` +
      "(one daily imports) and use the file it returns. Otherwise find it with `media_list` with { kind: \"audio\" } (or \"video\": the sound is taken out).",
    "`lyric_project` with { action: \"create\", title: <the song title> }. Keep the song's id. Free.",
    `\`lyric_set_song\` with { id, path: ${path} } (or the imported file). Free.`,
    "Ask the user for the lyrics if you do not have them: never invent or guess lyrics. `lyric_set_lyrics` with { id, sheet: <the lyrics, one sung line per line, " +
      "section headings such as [CHORUS] on their own lines> }. Free.",
    "`lyric_align` with { id }, then `jobs_wait` with { kind: \"lyric_align\", id } until done. Flagged lines could not be heard: move any that are off with `lyric_line_update` with { id, lineId: <the line's id, from `lyric_project` with { action: \"get\", id }>, start: <seconds> }. Free.",
    "Optional: `lyric_background` with { id, path: <a picture or video in your media folder> }. Free.",
    "`lyric_render` with { id }, then `jobs_wait` with { kind: \"lyric_render\", id: <the handle's id>, projectId: <the song's id> } until done (about the song's length). output.path is the video.",
  ];
}

const makeLyricVideo = {
  name: "make_lyric_video",
  title: "Make a lyric video",
  description:
    "Step list for a lyric video: set the song and its lyrics, time the lyrics to the singing, render. Never posts. " +
    "songPath is a file in your media folder (or a public URL to import first).",
  argsSchema: {
    songPath: z.string().trim().min(1).max(1000).describe("The song: an audio or video file in your media folder (media_list), or a public URL to import."),
  },
  render({ songPath }) {
    return message(`Make a lyric video for the song ${JSON.stringify(songPath)}. It never posts anywhere.`, lyricSteps(songPath));
  },
};

export const PROMPTS = [makeShortFromVerse, makeAmbientSession, makeLyricVideo];

/** Registers every prompt on one McpServer. The SDK validates the arguments against argsSchema first. */
export function registerPrompts(server) {
  for (const prompt of PROMPTS) {
    server.registerPrompt(
      prompt.name,
      { title: prompt.title, description: prompt.description, argsSchema: prompt.argsSchema },
      (args) => asPrompt(prompt.render(args)),
    );
  }
}
