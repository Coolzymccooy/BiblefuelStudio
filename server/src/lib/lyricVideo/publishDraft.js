import { YT_TITLE_MAX, YT_DESCRIPTION_MAX, YT_TAGS_TOTAL_MAX } from "../social/youtubeMetadata.js";

/**
 * The YouTube draft for a finished lyric video: the title, a description that
 * credits the artist and carries the lyrics, tags, and the Music category.
 * The user edits all of it in the publish panel before anything is uploaded.
 */

export const MUSIC_CATEGORY = "10";

// The API cannot set this for the user, so the panel tells them where it is.
export const SYNTHETIC_NOTE =
  "If this song was made with AI, open the video in YouTube Studio after it uploads and set “Altered or synthetic content” to Yes (Details → Show more).";

const SUFFIX = "(Official Lyric Video)";
const ARTIST_MAX = 40;
const HASHTAG_MAX = 40;
// YouTube refuses a title or description holding either of these.
const REFUSED = /[<>]/g;

const clean = (s) => String(s ?? "").replace(REFUSED, "").replace(/\s+/g, " ").trim();
const squash = (s) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

function shorten(text, max) {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function draftTitle(title, artist) {
  const suffix = artist ? ` — ${artist} ${SUFFIX}` : ` ${SUFFIX}`;
  return `${shorten(title, YT_TITLE_MAX - suffix.length)}${suffix}`;
}

/** The line that sings the title, else the first sung chorus line. */
function hookLine(project, title) {
  const leads = (project.lines || []).filter((l) => l.kind !== "response" && clean(l.text));
  const key = squash(title);
  const titled = key && leads.find((l) => squash(l.text).includes(key));
  if (titled) return clean(titled.text);
  const chorus = new Set((project.sections || []).filter((s) => s.kind === "chorus").map((s) => s.id));
  const first = leads.find((l) => chorus.has(l.sectionId));
  return first ? clean(first.text) : "";
}

/** The sheet as the user wrote it, tidied: section labels stay, runs of blank lines become one. */
function lyricsOf(raw) {
  return String(raw ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((row) => row.replace(REFUSED, "").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function hashtag(text) {
  const words = clean(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const tag = words.map((w) => w[0].toUpperCase() + w.slice(1)).join("");
  return tag && tag.length <= HASHTAG_MAX ? `#${tag}` : "";
}

/** Cuts the lyrics at a whole line, marked with "…", so they fit in `room` characters. */
function fitLyrics(lyrics, room) {
  if (lyrics.length <= room) return lyrics;
  const rows = lyrics.split("\n");
  while (rows.length && `${rows.join("\n")}\n…`.length > room) rows.pop();
  while (rows.length && !rows[rows.length - 1].trim()) rows.pop();
  return rows.length ? `${rows.join("\n")}\n…` : "";
}

function draftDescription(project, title, artist) {
  const hook = hookLine(project, title);
  const head = [artist && `🎵 Song by ${artist}`, hook && `“${hook}”`].filter(Boolean);
  const tags = ["#LyricVideo", hashtag(title), hashtag(artist)].filter(Boolean).join(" ");
  const fixed = [...head, tags].join("\n\n");
  const lyrics = lyricsOf(project.sheet?.raw);
  // Two blank-line joins sit either side of the lyrics block.
  const fitted = lyrics ? fitLyrics(lyrics, YT_DESCRIPTION_MAX - fixed.length - 4) : "";
  return [...head, fitted, tags].filter(Boolean).join("\n\n");
}

/** YouTube counts a tag with a space as quoted, and the commas between tags. */
const tagCost = (t) => t.length + (/\s/.test(t) ? 2 : 0) + 1;

function draftTags(title, artist) {
  const wanted = [title, artist, title && `${title} lyrics`, "lyric video", "lyrics"].filter(Boolean);
  const tags = [];
  let total = 0;
  for (const t of wanted) {
    if (tags.includes(t) || total + tagCost(t) > YT_TAGS_TOTAL_MAX) continue;
    tags.push(t);
    total += tagCost(t);
  }
  return tags;
}

export function buildPublishDraft(project) {
  const title = clean(project.title) || "Lyric video";
  const artist = shorten(clean(project.artist), ARTIST_MAX);
  return {
    title: draftTitle(title, artist),
    description: draftDescription(project, title, artist),
    tags: draftTags(title, artist),
    categoryId: MUSIC_CATEGORY,
    note: SYNTHETIC_NOTE,
  };
}
