/**
 * YouTube metadata rules, kept pure so scheduled uploads fail with a NAMED
 * reason before any bytes move. Limits are YouTube Data API v3 limits.
 */
export const YT_TITLE_MAX = 100;
export const YT_DESCRIPTION_MAX = 5000;
export const YT_TAGS_TOTAL_MAX = 500;
export const YT_DEFAULT_CATEGORY = "22"; // People & Blogs
const PRIVACY = new Set(["private", "unlisted", "public"]);
const MIN_CHAPTERS = 3;

export function formatChapterTimestamp(ms) {
  const total = Math.max(0, Math.floor(Number(ms) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * YouTube links any "12:34" in a description as a timestamp, so a verse like
 * "John 14:27" jumped the video to minute 14. U+2236 (RATIO) looks like a
 * colon and isn't linked. Only a colon between two digits is touched.
 */
export function unlinkVerseTimes(text) {
  return String(text || "").replace(/(\d):(?=\d)/g, "$1∶");
}

function chapterLines(chapters) {
  const list = (Array.isArray(chapters) ? chapters : [])
    .filter((c) => c && Number.isFinite(Number(c.startMs)) && String(c.title || "").trim())
    .sort((a, b) => Number(a.startMs) - Number(b.startMs));
  if (list.length < MIN_CHAPTERS) return [];
  // YouTube only recognises chapters when the first one is 00:00.
  const normalised = list.map((c, i) => (i === 0 ? { ...c, startMs: 0 } : c));
  return normalised.map((c) => `${formatChapterTimestamp(c.startMs)} ${unlinkVerseTimes(String(c.title).trim())}`);
}

export function buildYoutubeDescription({ summary = "", chapters = [], links = [], hashtags = [] } = {}) {
  const blocks = [];
  const s = String(summary || "").trim();
  if (s) blocks.push(s);
  const ch = chapterLines(chapters);
  if (ch.length) blocks.push(ch.join("\n"));
  const ls = (Array.isArray(links) ? links : []).map((l) => String(l).trim()).filter(Boolean);
  if (ls.length) blocks.push(ls.join("\n"));
  const hs = (Array.isArray(hashtags) ? hashtags : [])
    .map((h) => String(h).trim().replace(/^#/, ""))
    .filter(Boolean)
    .map((h) => `#${h}`);
  if (hs.length) blocks.push(hs.join(" "));
  return blocks.join("\n\n").slice(0, YT_DESCRIPTION_MAX);
}

function parsePublishAt(raw, now) {
  const text = String(raw || "").trim();
  if (!text) return { ok: true, value: undefined };
  const t = Date.parse(text);
  if (!Number.isFinite(t)) return { ok: false, error: "publishAt must be an ISO 8601 datetime" };
  if (t <= now) return { ok: false, error: "publishAt must be in the future" };
  return { ok: true, value: new Date(t).toISOString() };
}

export function validateYoutubeMetadata(input = {}, { now = Date.now() } = {}) {
  const title = String(input.title || "").trim();
  if (!title) return { ok: false, error: "title is required" };
  if (title.length > YT_TITLE_MAX) return { ok: false, error: `title must be ${YT_TITLE_MAX} characters or fewer (got ${title.length})` };

  const description = String(input.description || "").slice(0, YT_DESCRIPTION_MAX);

  const tags = (Array.isArray(input.tags) ? input.tags : []).map((t) => String(t).trim()).filter(Boolean);
  const tagsTotal = tags.reduce((n, t) => n + t.length, 0);
  if (tagsTotal > YT_TAGS_TOTAL_MAX) return { ok: false, error: `tags must total ${YT_TAGS_TOTAL_MAX} characters or fewer (got ${tagsTotal})` };

  const categoryId = String(input.categoryId || YT_DEFAULT_CATEGORY).trim() || YT_DEFAULT_CATEGORY;
  const requested = String(input.privacyStatus || "private").trim().toLowerCase();
  let privacyStatus = PRIVACY.has(requested) ? requested : "private";

  const publish = parsePublishAt(input.publishAt, now);
  if (!publish.ok) return publish;
  const forcedPrivate = Boolean(publish.value) && privacyStatus !== "private";
  if (publish.value) privacyStatus = "private";

  return {
    ok: true,
    value: { title, description, tags, categoryId, privacyStatus, publishAt: publish.value, forcedPrivate },
  };
}
