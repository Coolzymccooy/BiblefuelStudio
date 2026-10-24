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
 * half a second past its plan, so a long tail of silence is trimmed. Caption
 * words are always the script's own words, spread over the speech windows
 * that silence detection found in the clip (a transcript's word times are
 * not trusted on this audio). The music bed ducks under those same windows.
 */

export const CLIP_SLACK_SEC = 0.5;
export const DUCK_PAD_SEC = 0.15;
export const MAX_VERSE_CHARS = 200;
export const BRAND = "BibleFuel Studio";

const MIN_SPAN_SEC = 0.05;
const FALLBACK_LEAD_SEC = 0.15;
const FALLBACK_TAIL_SEC = 0.25;

const round = (n) => Math.round(n * 1000) / 1000;
const toFrames = (sec) => Math.max(0, Math.floor(Number(sec) * FPS + 1e-6));
const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
const weight = (w) => Math.max(1, norm(w).length);
const wordsOf = (text) => String(text || "").split(/\s+/).filter(Boolean);

/**
 * Seconds a shot's clip plays: its measured length, capped at its plan + 0.5 s,
 * on a whole frame. The plan is the length the clip was ordered at (kept on the
 * clip), so a later edit to the shot's seconds never cuts the clip mid-word.
 */
export function playedSec(shot) {
  const planned = Number(shot?.clip?.seconds) || Number(shot?.seconds) || 0;
  const measured = Number(shot?.clip?.durationSec);
  const sec = measured > 0 ? Math.min(measured, planned + CLIP_SLACK_SEC) : planned;
  return toFrames(sec) / FPS;
}

/**
 * Where each shot sits in the film: back to back after the verse card, a
 * dissolve only where the scene changes, and whether the whole fits 40 s.
 */
export function filmTimeline(project) {
  const start = toFrames(VERSE_CARD_SEC);
  let at = start;
  const shots = (project.shots || []).map((s, i, all) => {
    const len = toFrames(playedSec(s));
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

/**
 * The verse as the card shows it: whitespace tidied and, when it is too long
 * for about four lines, cut at the last sentence end that fits (else the last
 * whole word, with an ellipsis).
 */
export function verseText(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= MAX_VERSE_CHARS) return clean;
  const head = clean.slice(0, MAX_VERSE_CHARS);
  const sentence = Math.max(...[".", ";", "!", "?"].map((c) => head.lastIndexOf(c)));
  if (sentence >= MAX_VERSE_CHARS * 0.4) return head.slice(0, sentence + 1);
  const space = head.lastIndexOf(" ");
  return `${(space > 0 ? head.slice(0, space) : head).replace(/[,:;\s]+$/, "")}…`;
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
