/**
 * "Write it for me" (spec section 7.2): the LLM drafts a cartoon script from a
 * verse or a theme, and the code decides whether to accept the draft.
 *
 * The model is never trusted. A draft is accepted only when it parses with no
 * ignored lines, has at most 3 speaking characters, fits the 40 second film
 * (and the shot and line limits), and never puts words in Jesus's mouth that
 * are not quoted exactly from the Bible text BibleFuel holds. A bad draft gets
 * one retry with the reasons spelled out; a second bad draft is WRITE_FAILED.
 *
 * The verse is looked up first (or, for a theme, looked up from the reference
 * the model chose), so the model never types the verse text itself and the
 * `Verse:` line always carries the canonical reference.
 *
 * Both the LLM and the Bible lookup are injected, so tests make no real calls.
 */

import { defaultLlmComplete } from "../story/scriptRefine.js";
import { lookupVerses } from "../bible/scriptureApi.js";
import { parseCartoonScript } from "./parse.js";
import { planShots, checkFilm, MAX_SHOTS, MAX_FILM_SEC, VERSE_CARD_SEC, END_CARD_SEC } from "./plan.js";
import { unquotedJesusLines } from "./scripture.js";
import { STYLES, styleId } from "./styles.js";
import { EXAMPLES } from "./examples.js";

const MAX_SPEAKERS = 3;
const MAX_LINE_WORDS = 25;
const MAX_STORY_SEC = MAX_FILM_SEC - VERSE_CARD_SEC - END_CARD_SEC; // 34.5, quoted to the model as 34
const FENCE_RE = /^```[a-z]*[ \t]*\r?\n([\s\S]*?)\r?\n?```\s*$/i;
const VERSE_LINE_RE = /^[ \t]*verse[ \t]*:.*$/im;
const STYLE_LINE_RE = /^[ \t]*style[ \t]*:.*$/im;
const TITLE_LINE_RE = /^#[ \t]+.*$/m;

// Fixed on purpose: the model's own words never reach the user-facing error. The reasons ride along for logs.
const WRITE_FAILED_MESSAGE = "BibleFuel couldn't write a script that fits. Try a shorter theme or another verse.";

function failure(code, error) {
  return { ok: false, code, error };
}

/** The reply without a ```markdown fence, if the model wrapped it in one. */
function stripFence(text) {
  const trimmed = String(text ?? "").trim();
  const fenced = FENCE_RE.exec(trimmed);
  return (fenced ? fenced[1] : trimmed).trim();
}

/** Looks a reference up; null on a throw, `ok: false` or no text. */
async function findVerse(reference, lookup) {
  try {
    const found = await lookup(reference);
    const verses = Array.isArray(found?.verses) ? found.verses : [];
    const text = verses.map((verse) => String(verse?.text ?? "").trim()).filter(Boolean).join(" ");
    if (!found || found.ok === false || text === "") return null;
    return { canonical: String(found.canonical || reference).trim(), text };
  } catch {
    return null;
  }
}

function buildPrompt({ theme, cast, styleLabel, verseInfo, problems, previous }) {
  const lines = [
    "You write short cartoon scripts for a Christian family channel. Write one script in exactly the format shown in the example.",
    "",
    "Format example:",
    EXAMPLES[0].markdown.trim(),
    "",
    "Rules:",
    `- At most ${MAX_SPEAKERS} speaking characters. Every character who speaks must be in the Cast list.`,
    `- At most ${MAX_SHOTS} shots in total. One spoken line is one shot; a (bracketed action) rides with the line before it.`,
    `- At most ${MAX_LINE_WORDS} words in any one spoken line, and one speaker per line.`,
    `- The spoken words must fit in about ${Math.floor(MAX_STORY_SEC)} seconds at 2.5 words per second, so keep the whole story short.`,
    "- Use at least one Scene: change, and give each Scene: a place and a camera note after a comma.",
    "- Each Cast entry has a vivid look (age, skin, hair, clothing colours, one distinctive detail) and a short voice descriptor after Voice:, such as \"bright and eager, a young boy\". A character who never speaks may omit the voice.",
    "- Warm, reverent and suitable for a family audience. Original modern dialogue in everyday language, never a copy of Bible wording.",
    "- Never name a film studio, brand or trademark anywhere: not in the title, the looks, the voices, the lines or the notes. Describe the look in plain words instead.",
    `- The Style: line must be exactly "Style: ${styleLabel}".`,
    "- Output only the script, with no commentary and no code fence.",
  ];
  if (verseInfo) {
    lines.push(
      "- Jesus may appear with reverence. Jesus, the Lord and God may speak only words copied exactly from the verse text below. Never invent words for them.",
      `- The Verse: line must be "Verse: ${verseInfo.canonical}".`,
      "",
      `Verse (${verseInfo.canonical}):`,
      verseInfo.text,
    );
  } else {
    lines.push(
      "- Jesus, the Lord and God must not speak and must have no lines, because no verse text is available to quote. Jesus may be shown in a bracketed action only if essential.",
      "- Choose a Bible passage that fits the theme and put its reference on the Verse: line (for example \"Verse: Luke 15:4\"). The story must be true to that passage.",
    );
  }
  if (theme) lines.push("", `Theme: ${theme}`);
  if (cast) lines.push("", `Suggested cast and ideas from the person asking: ${cast}`);
  if (problems.length > 0) {
    lines.push(
      "",
      "Your previous draft was rejected. Write the whole script again and fix every problem:",
      ...problems.map((problem) => `- ${problem}`),
      "",
      "Previous draft:",
      previous,
    );
  }
  return lines.join("\n");
}

/** Problems found in a draft's film (parse, speakers, length, shot and line limits). */
function filmProblems(parsed) {
  const problems = [];
  if (parsed.ignored.length > 0) {
    const shown = parsed.ignored.slice(0, 3).map((item) => `"${item.text}"`).join(", ");
    problems.push(`These lines do not fit the format and were ignored: ${shown}. Every line must be a Scene:, a Name: "line" or a (bracketed action).`);
  }
  if (parsed.scenes.length === 0 || planShots(parsed).length === 0) {
    problems.push("The script has no scenes with spoken lines. Add Scene: headings with Name: \"line\" dialogue.");
    return problems;
  }
  const speakers = new Set();
  for (const scene of parsed.scenes) {
    for (const beat of scene.beats) if (beat.kind === "line") speakers.add(beat.speaker.toLowerCase());
  }
  if (speakers.size > MAX_SPEAKERS) {
    problems.push(`There are ${speakers.size} speaking characters; the limit is ${MAX_SPEAKERS} speaking characters.`);
  }
  const shots = planShots(parsed);
  const film = checkFilm(shots, parsed.scenes);
  if (!film.ok) {
    problems.push(`The film is too long: ${film.filmSec} seconds with the cards, ${film.overBySec} over the ${MAX_FILM_SEC} second limit. Cut lines or shorten them.`);
  }
  if (film.tooMany) problems.push(`There are ${shots.length} shots; the limit is ${MAX_SHOTS}. Cut some lines.`);
  if (film.tooLong.length > 0) {
    problems.push(`Some lines are too long (${film.tooLong.map((item) => `${item.words} words`).join(", ")}); keep every line to ${MAX_LINE_WORDS} words or fewer.`);
  }
  return problems;
}

/**
 * A studio's trademark (spec section 3) never reaches BibleFuel's own text:
 * the title, looks and voices go into every prompt, the title and the post.
 * Checked in code, anywhere in the draft, rather than trusted to the prompt.
 */
const STUDIO_NAME_RE = /pixar/i;
const STUDIO_NAME_ALL_RE = /pixar/gi;
const STUDIO_PROBLEM = "The script names a film studio. Remove every studio or brand name from the title, looks, voices, lines and notes, and describe the look in plain words.";

/** The draft as it may be quoted back to the model: a studio's name is never repeated in a prompt. */
const withoutStudioName = (draft) => String(draft).replace(STUDIO_NAME_ALL_RE, "[studio name]");

function jesusProblems(parsed, verseText) {
  return unquotedJesusLines(parsed, verseText).map(
    (item) => `Jesus (or the Lord or God) says "${item.text}", which is not quoted exactly from the verse. Remove it or replace it with words copied exactly from the verse text; Jesus and God never get invented words.`,
  );
}

/** Replaces the first `pattern` line with `line`, or inserts it after the title (or at the top). */
function setHeaderLine(markdown, pattern, line) {
  if (pattern.test(markdown)) return markdown.replace(pattern, () => line);
  const title = TITLE_LINE_RE.exec(markdown);
  if (!title) return `${line}\n${markdown}`;
  const end = title.index + title[0].length;
  return `${markdown.slice(0, end)}\n${line}${markdown.slice(end)}`;
}

/** Checks one draft. Returns `{ problems }` or `{ problems: [], markdown, verseText }` when accepted. */
async function judgeDraft(reply, { verseInfo, styleLabel, lookup }) {
  const draft = stripFence(reply);
  if (draft === "") return { problems: ["The reply was empty."], draft };
  const parsed = parseCartoonScript(draft);
  const problems = filmProblems(parsed);
  if (STUDIO_NAME_RE.test(draft)) problems.push(STUDIO_PROBLEM);

  let verse = verseInfo;
  if (!verse) {
    if (parsed.verse === "") {
      problems.push("There is no Verse: line. Add one with the reference of the Bible passage the story is based on.");
    } else {
      verse = await findVerse(parsed.verse, lookup);
      if (!verse) problems.push(`The Bible reference "${parsed.verse}" could not be found. Choose a real passage reference such as "Luke 15:4".`);
    }
  }
  problems.push(...jesusProblems(parsed, verse ? verse.text : ""));
  if (problems.length > 0 || !verse) return { problems, draft };

  const withVerse = setHeaderLine(draft, VERSE_LINE_RE, `Verse: ${verse.canonical}`);
  const markdown = setHeaderLine(withVerse, STYLE_LINE_RE, `Style: ${styleLabel}`);
  return { problems: [], markdown, verseText: verse.text };
}

/**
 * Drafts a cartoon script for a verse and/or a theme.
 *
 * @param {{ verse?: string, theme?: string, cast?: string, style?: string }} request
 * @param {{ llm?: (prompt: string) => Promise<string>, lookup?: (reference: string) => Promise<object> }} [deps]
 * @returns {Promise<{ ok: true, markdown: string, verseText: string } | { ok: false, code: "NO_VERSE" | "WRITE_FAILED", error: string }>}
 */
export async function writeCartoonScript(request, { llm = defaultLlmComplete, lookup = lookupVerses } = {}) {
  const verse = String(request?.verse ?? "").trim();
  const theme = String(request?.theme ?? "").trim();
  const cast = String(request?.cast ?? "").trim();
  if (verse === "" && theme === "") return failure("NO_VERSE", "Give a verse or a theme to write from.");

  let verseInfo = null;
  if (verse !== "") {
    verseInfo = await findVerse(verse, lookup);
    if (!verseInfo) return failure("NO_VERSE", `Could not find "${verse}" in the Bible text. Check the reference.`);
  }

  const styleLabel = STYLES[styleId(request?.style)].label;
  let problems = [];
  let previous = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const prompt = buildPrompt({ theme, cast, styleLabel, verseInfo, problems, previous });
    let reply = "";
    try {
      reply = await llm(prompt);
    } catch {
      problems = ["The writer could not be reached."];
      previous = "";
      continue;
    }
    const judged = await judgeDraft(reply, { verseInfo, styleLabel, lookup });
    if (judged.problems.length === 0) return { ok: true, markdown: judged.markdown, verseText: judged.verseText };
    // Reasons can quote the draft's own lines, so both are cleaned before they reach the next prompt.
    problems = judged.problems.map(withoutStudioName);
    previous = withoutStudioName(judged.draft);
  }
  return { ...failure("WRITE_FAILED", WRITE_FAILED_MESSAGE), reasons: problems };
}
