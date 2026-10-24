import { FPS, FRAME } from "../sceneScript/renderData.js";
import { VERSE_CARD_SEC, END_CARD_SEC, MAX_FILM_SEC } from "./plan.js";
import { BED_BASE, BED_DUCK } from "./filmCurves.js";

/**
 * The props the "Cartoon" Remotion composition renders from (spec section
 * 7.7). Every time is in film seconds on a whole frame, every file is a URL
 * the render can fetch. Pure: the render stage stages the files and passes
 * their names in.
 *
 * The film is the verse card, then each clip in order with its own sound,
 * then the end card. A clip plays to its measured length but never more than
 * half a second past its plan, so a long tail of silence is trimmed, and
 * never stops before its last word. A film that still runs over 40 s has its
 * clip tails trimmed until it fits, again never into a word. Caption
 * words are always the script's own words, spread over the speech windows
 * that silence detection found in the clip (a transcript's word times are
 * not trusted on this audio). The music bed ducks under those same windows.
 */

export const CLIP_SLACK_SEC = 0.5;
export const DUCK_PAD_SEC = 0.15;
export const MAX_VERSE_CHARS = 200;
export const BRAND = "BibleFuel Studio";

const MIN_SPAN_SEC = 0.05;
/** The shortest a clip is trimmed to when the film runs long: a silent shot still reads as a shot. */
const MIN_TRIMMED_SEC = 1;
const FALLBACK_LEAD_SEC = 0.15;
const FALLBACK_TAIL_SEC = 0.25;

const round = (n) => Math.round(n * 1000) / 1000;
const toFrames = (sec) => Math.max(0, Math.floor(Number(sec) * FPS + 1e-6));
const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
const weight = (w) => Math.max(1, norm(w).length);
const wordsOf = (text) => String(text || "").split(/\s+/).filter(Boolean);

/** Where the clip's last speech window ends, clip-relative seconds; 0 for a clip with no speech. */
function lastSpeechEnd(shot) {
  const raw = Array.isArray(shot?.clip?.windows) ? shot.clip.windows : [];
  return raw.reduce((end, w) => (Number.isFinite(Number(w?.to)) ? Math.max(end, Number(w.to)) : end), 0);
}

/**
 * How many frames a shot's clip may play (spec sections 5 and 8.6). `max` is
 * its measured length capped at its plan + 0.5 s, but never cut before its
 * last speech window ends. `planned` and `speech` are the floors a tail is
 * trimmed to when the film runs long: first never below its plan (or its last
 * word), then never below its last word (a silent clip keeps a second). The
 * plan is the length the clip was ordered at (kept on the clip), so a later
 * edit to the shot's seconds never cuts the clip mid-word.
 */
export function clipFrames(shot) {
  const planned = Number(shot?.clip?.seconds) || Number(shot?.seconds) || 0;
  const durationSec = Number(shot?.clip?.durationSec);
  const measured = durationSec > 0 ? toFrames(durationSec) : toFrames(planned);
  const speechEnd = Math.min(measured, Math.ceil(lastSpeechEnd(shot) * FPS - 1e-6));
  const capped = Math.min(measured, toFrames(planned + CLIP_SLACK_SEC));
  const max = Math.max(capped, speechEnd);
  const speech = Math.min(max, Math.max(speechEnd, toFrames(MIN_TRIMMED_SEC)));
  return { max, planned: Math.min(max, Math.max(speech, toFrames(planned))), speech };
}

/** Seconds a shot's clip plays when the film has room: see clipFrames. */
export function playedSec(shot) {
  return clipFrames(shot).max / FPS;
}

/** Take `excess` frames off `frames`, one at a time from the clip furthest above its floor. */
function trimTails(frames, floors, excess) {
  const out = [...frames];
  let left = excess;
  while (left > 0) {
    let pick = -1;
    out.forEach((f, i) => { if (f > floors[i] && (pick < 0 || f - floors[i] > out[pick] - floors[pick])) pick = i; });
    if (pick < 0) break;
    out[pick] -= 1;
    left -= 1;
  }
  return out;
}

/**
 * Frames each clip plays so the film fits 40 s whenever it can. Every clip
 * plays its `max`; a film that then runs long has its clip tails trimmed,
 * the longest overhang first, never before a clip's last word ends. It still
 * runs long only when the speech itself can't fit.
 */
export function fitClipFrames(project) {
  const bounds = (project.shots || []).map(clipFrames);
  const room = toFrames(MAX_FILM_SEC) - toFrames(VERSE_CARD_SEC) - toFrames(END_CARD_SEC);
  const over = (frames) => frames.reduce((a, f) => a + f, 0) - room;
  const first = trimTails(bounds.map((b) => b.max), bounds.map((b) => b.planned), over(bounds.map((b) => b.max)));
  return trimTails(first, bounds.map((b) => b.speech), over(first));
}

/**
 * Where each shot sits in the film: back to back after the verse card, a
 * dissolve only where the scene changes, and whether the whole fits 40 s.
 */
export function filmTimeline(project) {
  const start = toFrames(VERSE_CARD_SEC);
  const fitted = fitClipFrames(project);
  let at = start;
  const shots = (project.shots || []).map((s, i, all) => {
    const len = fitted[i];
    const placed = {
      id: s.id, sceneId: s.sceneId, from: at / FPS, to: (at + len) / FPS, len: len / FPS,
      dissolve: i > 0 && s.sceneId !== all[i - 1].sceneId,
    };
    at += len;
    return placed;
  });
  const total = (at + toFrames(END_CARD_SEC)) / FPS;
  return { shots, storySec: (at - start) / FPS, total, fits: total <= MAX_FILM_SEC + 1e-9 };
}

/** A clip's speech windows inside the part that plays, clip-relative, in order. */
function speechSpans(shot, len) {
  const raw = Array.isArray(shot?.clip?.windows) ? shot.clip.windows : [];
  return raw
    .map((w) => ({ from: Math.max(0, Number(w?.from)), to: Math.min(len, Number(w?.to)) }))
    .filter((w) => Number.isFinite(w.from) && Number.isFinite(w.to) && w.to - w.from >= MIN_SPAN_SEC)
    .sort((a, b) => a.from - b.from);
}

/** Where a spoken line is heard: its windows, or nearly the whole clip when none were found. */
function lineSpans(shot, len) {
  const spans = speechSpans(shot, len);
  if (spans.length) return spans;
  const from = Math.min(FALLBACK_LEAD_SEC, len / 4);
  return [{ from, to: Math.max(from + MIN_SPAN_SEC, len - FALLBACK_TAIL_SEC) }];
}

/**
 * The line's words placed in its spans: each word goes to the span holding
 * the middle of its share of the speech time, then each span's words are
 * spread across it by length. Clip-relative seconds.
 */
function timeWords(text, spans) {
  const words = wordsOf(text);
  if (!words.length) return [];
  const totalWeight = words.reduce((a, w) => a + weight(w), 0);
  const speech = spans.reduce((a, s) => a + (s.to - s.from), 0);
  const ends = [];
  spans.reduce((acc, s) => { ends.push(acc + (s.to - s.from)); return ends.at(-1); }, 0);
  const groups = spans.map(() => []);
  let acc = 0;
  for (const w of words) {
    const share = (weight(w) / totalWeight) * speech;
    const mid = acc + share / 2;
    acc += share;
    const index = ends.findIndex((e) => mid <= e + 1e-9);
    groups[index === -1 ? spans.length - 1 : index].push(w);
  }
  return spans.flatMap((span, i) => {
    const group = groups[i];
    const groupWeight = group.reduce((a, w) => a + weight(w), 0);
    let t = span.from;
    return group.map((w) => {
      const d = (weight(w) / groupWeight) * (span.to - span.from);
      const item = { text: w, start: t, end: t + d };
      t += d;
      return item;
    });
  });
}

/** One caption per spoken shot, in film time; the speaker's name shows the first time they speak. */
export function cartoonCaptions(project, timeline) {
  const seen = new Set();
  const byId = new Map(timeline.shots.map((s) => [s.id, s]));
  return (project.shots || [])
    .filter((s) => typeof s.line === "string" && s.line.trim())
    .map((s) => {
      const placed = byId.get(s.id);
      const speaker = s.speaker || "";
      const showName = Boolean(speaker) && !seen.has(speaker);
      seen.add(speaker);
      const words = timeWords(s.line, lineSpans(s, placed.len))
        .map((w) => ({ text: w.text, start: round(placed.from + w.start), end: round(placed.from + w.end) }));
      return { shotId: s.id, speaker, showName, from: placed.from, to: placed.to, words };
    });
}

/** Every shot's speech windows in film time, padded, merged where they meet. The bed ducks inside them. */
export function duckWindows(project, timeline) {
  const byId = new Map((project.shots || []).map((s) => [s.id, s]));
  const padded = timeline.shots.flatMap((placed) => {
    const shot = byId.get(placed.id);
    const spoken = typeof shot?.line === "string" && shot.line.trim();
    const spans = spoken ? lineSpans(shot, placed.len) : speechSpans(shot, placed.len);
    return spans.map((w) => ({
      from: Math.max(0, placed.from + w.from - DUCK_PAD_SEC),
      to: Math.min(timeline.total, placed.from + w.to + DUCK_PAD_SEC),
    }));
  }).sort((a, b) => a.from - b.from);
  const merged = [];
  for (const w of padded) {
    const last = merged[merged.length - 1];
    if (last && w.from <= last.to) merged[merged.length - 1] = { from: last.from, to: Math.max(last.to, w.to) };
    else merged.push(w);
  }
  return merged.map((w) => ({ from: round(w.from), to: round(w.to) }));
}

/** Where the last full sentence in `text` ends (after any closing quote or bracket), or -1. */
function lastSentenceEnd(text) {
  const re = /[.!?]["'”’)\]]*(?=\s|$)/g;
  let end = -1;
  for (let m = re.exec(text); m; m = re.exec(text)) end = m.index + m[0].length;
  return end;
}

/**
 * The verse as the card shows it: whitespace tidied and, when it is too long
 * for about four lines, cut to a clean end: the last full sentence that fits,
 * else just before the last semicolon or colon with an ellipsis, else the last
 * whole word with an ellipsis. The card never ends on ; , or :.
 */
export function verseText(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= MAX_VERSE_CHARS) return clean;
  const head = clean.slice(0, MAX_VERSE_CHARS - 1); // room for the ellipsis
  const enough = MAX_VERSE_CHARS * 0.4;
  const sentence = lastSentenceEnd(head);
  if (sentence >= enough) return head.slice(0, sentence);
  const clause = Math.max(head.lastIndexOf(";"), head.lastIndexOf(":"));
  const space = head.lastIndexOf(" ");
  const cut = clause >= enough ? clause : (space > 0 ? space : head.length);
  return `${head.slice(0, cut).replace(/[,:;\s]+$/, "")}…`;
}

/**
 * @param {object} project a cartoon whose shots all have done clips
 * @param {{ url: (name: string) => string, names: { clips: Record<string,string>, bed?: string|null, fonts: Record<string,string> } }} assets
 */
export function buildCartoonRenderData(project, { url, names }) {
  const timeline = filmTimeline(project);
  const frame = FRAME[project.meta?.aspect] || FRAME.portrait;
  const total = timeline.total;
  const reference = project.meta?.verse?.reference || "";
  return {
    fps: FPS, width: frame.width, height: frame.height, total,
    verse: { reference, text: verseText(project.meta?.verse?.text), from: 0, to: VERSE_CARD_SEC },
    shots: timeline.shots.map((s) => ({
      id: s.id, sceneId: s.sceneId, from: s.from, to: s.to, src: url(names.clips[s.id]), trimTo: s.len, dissolve: s.dissolve,
    })),
    captions: cartoonCaptions(project, timeline),
    captionsOn: project.captions?.enabled !== false,
    bed: project.music?.bed && names.bed
      ? { src: url(names.bed), base: BED_BASE, duck: BED_DUCK, windows: duckWindows(project, timeline) }
      : null,
    endCard: {
      from: total - END_CARD_SEC, to: total, reference,
      text: String(project.endCard?.text || "").trim() || project.meta?.title || "", brand: BRAND,
    },
    fonts: Object.fromEntries(Object.entries(names.fonts || {}).map(([k, v]) => [k, url(v)])),
  };
}
