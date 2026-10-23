/**
 * Lay voiced lines end to end. Each line keeps its real duration; the pause
 * after it comes from simple rules (or the operator's own value), so scenes
 * land near the script's timestamps without stretching any voice.
 */

export const INTRO_SEC = 1.6;
export const OUTRO_PAD_SEC = 0.5;
export const GAP = Object.freeze({
  base: 0.35,
  ellipsis: 0.3,
  emphasis: 0.4,
  sceneEnd: 0.6,
  beforeDrop: 1.3,
  chant: 1.2,
  finalChant: 3.0,
});

const endsWithEllipsis = (t) => /(…|\.\.\.)["”']?\s*$/.test(String(t || ""));

/** The pause after a line, by rule, unless the operator set one. */
export function gapAfter(line, { lastInScene = false, beforeDrop = false, lastLine = false } = {}) {
  const own = Number(line.gapAfter);
  if (line.gapAfter !== undefined && line.gapAfter !== null && Number.isFinite(own)) return Math.max(0, Math.min(10, own));
  if (line.kind === "chant") return lastLine ? GAP.finalChant : GAP.chant;
  if (beforeDrop) return GAP.beforeDrop;
  let gap = GAP.base;
  if (endsWithEllipsis(line.text)) gap += GAP.ellipsis;
  if (line.emphasis) gap += GAP.emphasis;
  if (lastInScene) gap += GAP.sceneEnd;
  return +gap.toFixed(3);
}

/**
 * @param {{ scenes: Array<{id: string}>, lines: Array<object>, music?: { drops?: Array<{beforeLineId: string}> } }} script
 * @param {Record<string, number>} durations seconds per line id
 * @returns {{ total: number, intro: number, lines: Array<{id: string, start: number, dur: number, gap: number}>, scenes: Array<{id: string, start: number, end: number}>, drop: {from: number, to: number}|null, missing: string[] }}
 */
export function computeTimeline(script, durations, { intro = INTRO_SEC } = {}) {
  const dropBefore = new Set((script.music?.drops || []).map((d) => d.beforeLineId));
  const all = script.lines;
  const missing = all.filter((l) => !(Number(durations[l.id]) > 0)).map((l) => l.id);
  const lines = [];
  let cursor = intro;
  all.forEach((line, i) => {
    const next = all[i + 1];
    const dur = Number(durations[line.id]) || 0;
    const gap = gapAfter(line, {
      lastInScene: !next || next.sceneId !== line.sceneId,
      beforeDrop: Boolean(next && dropBefore.has(next.id)),
      lastLine: !next,
    });
    lines.push({ id: line.id, sceneId: line.sceneId, start: +cursor.toFixed(3), dur: +dur.toFixed(3), gap });
    cursor += dur + gap;
  });
  const total = +(cursor + OUTRO_PAD_SEC).toFixed(3);
  const scenes = script.scenes.map((s) => {
    const own = lines.filter((l) => l.sceneId === s.id);
    return { id: s.id, start: own.length ? own[0].start : null, end: null };
  });
  scenes.forEach((s, i) => {
    const later = scenes.slice(i + 1).find((x) => x.start !== null);
    s.end = later ? later.start : total;
  });
  if (scenes[0] && scenes[0].start !== null) scenes[0].start = 0;
  const dropLine = lines.find((l) => dropBefore.has(l.id));
  const before = dropLine ? lines[lines.indexOf(dropLine) - 1] : null;
  const drop = dropLine && before ? { from: +(before.start + before.dur).toFixed(3), to: dropLine.start } : null;
  return { total, intro, lines, scenes, drop, missing };
}
