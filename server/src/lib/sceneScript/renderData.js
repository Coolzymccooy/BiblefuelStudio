import { shotSpans } from "./shots.js";
import { baseLevel } from "./mixCurve.js";

/**
 * The props the Remotion composition renders from: every time is in
 * composition seconds, every file is a URL the render can fetch. Built from
 * a voiced project with all of its shots filled.
 */

export const FPS = 30;
export const FRAME = Object.freeze({
  portrait: Object.freeze({ width: 1080, height: 1920 }),
  landscape: Object.freeze({ width: 1920, height: 1080 }),
  square: Object.freeze({ width: 1080, height: 1080 }),
});
const SECTION_LEAD_IN = 0.7;
const SECTION_TAIL = 1.6;
const SPEAKER_VERB_RE = /\s+(declared|said|wrote|writes|says|proclaimed|cried|prayed)\s*:?\s*$/i;

/** "The Apostle Paul declared:" before a quote -> "THE APOSTLE PAUL". */
function scriptureLabel(lines, index) {
  const prev = lines[index - 1];
  if (!prev || prev.sceneId !== lines[index].sceneId || !/:\s*$/.test(prev.text)) return "";
  const who = prev.text.replace(SPEAKER_VERB_RE, "").replace(/:\s*$/, "").trim();
  return who.length <= 40 ? who.toUpperCase() : "";
}

/**
 * Music sections from cues: each starts a little before its first scene and
 * overlaps the next cue so the beds crossfade.
 */
export function musicSections(project, timeline) {
  const sceneTime = Object.fromEntries(timeline.scenes.map((s) => [s.id, s]));
  const placed = project.music.cues
    .map((c) => {
      const starts = c.sceneIds.map((id) => sceneTime[id]?.start).filter((x) => x !== null && x !== undefined);
      return starts.length ? { cue: c, start: Math.min(...starts) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
  return placed.map((x, i) => {
    const next = placed[i + 1];
    const from = i === 0 ? 0 : Math.max(0, x.start - SECTION_LEAD_IN);
    const to = next ? Math.min(timeline.total, next.start + SECTION_TAIL) : timeline.total;
    const gated = Boolean(timeline.drop && timeline.drop.from >= from && timeline.drop.from < to);
    return {
      id: x.cue.id, bed: x.cue.bed, offsetSec: Number(x.cue.offsetSec) || 0,
      from: +from.toFixed(3), to: +to.toFixed(3), base: baseLevel(x.cue.mood), first: i === 0, gated,
      heartbeat: (x.cue.sfx || []).includes("heartbeat"),
    };
  });
}

/**
 * @param {object} project a voiced project whose shots all have clips
 * @param {{ url: (name: string) => string, names: { voice: Record<string,string>, music: Record<string,string>, clips: Record<string,string>, fonts: object, heartbeat?: string, impact?: string } }} assets
 */
export function buildRenderData(project, assets) {
  const tl = project.timeline;
  const frame = FRAME[project.meta?.aspect] || FRAME.portrait;
  const byId = Object.fromEntries(tl.lines.map((l) => [l.id, l]));
  const lines = project.lines.map((l, i) => ({
    id: l.id, kind: l.kind, text: l.text, emphasis: Boolean(l.emphasis),
    start: byId[l.id].start, dur: byId[l.id].dur, gap: byId[l.id].gap,
    words: l.audio?.words || [],
    label: l.kind === "scripture" ? scriptureLabel(project.lines, i) : "",
    reference: l.reference || "",
  }));
  const spans = shotSpans(project.shots, tl);
  const shots = spans.map((s) => {
    const shot = project.shots.find((x) => x.id === s.id);
    return { id: s.id, from: s.from, to: s.to, src: assets.url(assets.names.clips[s.id]), clipDur: Number(shot.clip?.durationSec) || s.seconds };
  });
  const sections = musicSections(project, tl);
  const lastChant = lines.at(-1)?.kind === "chant" ? lines.at(-1) : null;
  const hb = sections.find((s) => s.heartbeat);
  return {
    fps: FPS, width: frame.width, height: frame.height, total: tl.total, intro: tl.intro,
    title: project.meta?.title || "", reference: project.meta?.reference || "",
    captions: project.captions?.enabled !== false,
    lines,
    voice: lines.map((l) => ({ id: l.id, start: l.start, src: assets.url(assets.names.voice[l.id]) })),
    shots,
    music: sections.map((s) => ({ ...s, src: assets.url(assets.names.music[s.id]) })),
    drop: tl.drop,
    hit: tl.drop ? tl.drop.to : null,
    heartbeat: hb && assets.names.heartbeat ? { src: assets.url(assets.names.heartbeat), from: hb.from, to: hb.to } : null,
    impact: tl.drop && assets.names.impact ? { src: assets.url(assets.names.impact), at: tl.drop.to - 0.03 } : null,
    endCard: project.endCard ? { ...project.endCard, at: lastChant ? lastChant.start : Math.max(0, tl.total - 4) } : null,
    fonts: Object.fromEntries(Object.entries(assets.names.fonts).map(([k, v]) => [k, assets.url(v)])),
    brand: "BibleFuel Studio",
  };
}
