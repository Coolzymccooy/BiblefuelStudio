/**
 * Shots: each scene's Visual becomes one or more Seedance clips. A shot runs
 * from its start line to the next shot's start line. Prompts are the
 * author's visual with the lead character's description put in place of
 * "a man" / "the central character", music sentences removed, a framing per
 * shot so repeated visuals still vary, and the project's style line.
 */

export const STYLE_SUFFIX = "Cinematic film still in motion, shot on 35mm, anamorphic, shallow depth of field, "
  + "warm golden practical light against deep shadow, rich contrast, gentle film grain, photorealistic, "
  + "slow deliberate camera movement.";
export const DEFAULT_LEAD_MAN = "a Black Nigerian man in his late thirties with a short neat beard and moustache "
  + "and close-cropped hair, wearing a faded olive-grey button-up work shirt with a chest pocket";
export const DEFAULT_PEOPLE_NOTE = "Every person shown is Black African unless described otherwise.";
export const SHOT_TARGET_SEC = 7;
export const MAX_SHOTS_PER_SCENE = 6;
const WORDS_PER_SEC = 2.6;

const FRAMINGS = Object.freeze([
  "Wide establishing shot.",
  "Slow push-in to a close-up.",
  "Medium shot from a low angle.",
  "Slow tracking shot alongside.",
  "Extreme close-up on the details.",
  "Gentle aerial drift.",
]);

const LEAD_RE = /\b(an?|the)\s+(man|central character|main character|figure|protagonist|young man|person)\b/i;
const MUSIC_CLAUSE_RE = /\s*,?\s*\b(as|while|when)\s+the\s+(music|instrumental|score|choir|soundtrack)\b[^.]*/gi;
const MUSIC_SENTENCE_RE = /\b(music|instrumental|soundtrack|crescendo|score|piano|choir sings)\b/i;
const MONTAGE_RE = /\bmontage of\s+(.+?)\.?$/i;

/** The visual without the parts a camera cannot film (music, sound). */
export function filmableVisual(visual) {
  return String(visual || "")
    .replace(MUSIC_CLAUSE_RE, "")
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim() && !MUSIC_SENTENCE_RE.test(s))
    .join(" ")
    .trim();
}

/** "a mother caring for her children, a young man working late, and a worshipper" -> 3 subjects. */
export function montageSubjects(visual) {
  const m = MONTAGE_RE.exec(filmableVisual(visual));
  if (!m) return [];
  return m[1].split(/,\s*(?:and\s+)?|\s+and\s+(?=an?\s|the\s)/i).map((s) => s.trim()).filter(Boolean);
}

/** Does the visual name the lead character the descriptor should replace? */
export function mentionsLead(visual) {
  return LEAD_RE.test(String(visual || ""));
}

const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The Seedance prompt for one shot. A montage subject ("a young man working
 * late") is someone else, so the lead's description is only put in for
 * shots that film the scene's own visual.
 */
export function promptForShot({ text, lead, montage = false, peopleNote = DEFAULT_PEOPLE_NOTE, framing = "", style = STYLE_SUFFIX }) {
  let body = filmableVisual(text);
  if (lead && !montage && LEAD_RE.test(body)) {
    body = body.replace(LEAD_RE, (m) => (/^[A-Z]/.test(m) ? capitalise(lead) : lead));
  }
  body = capitalise(body.trim()).replace(/([^.!?])$/, "$1.");
  return [framing, body, peopleNote, style].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function estimatedStarts(lines) {
  let t = 0;
  return lines.map((l) => {
    const start = t;
    t += String(l.text).split(/\s+/).length / WORDS_PER_SEC + 0.5;
    return { line: l, start };
  });
}

function sceneSeconds(scene, lines) {
  if (scene.targetStart !== null && scene.targetEnd !== null && scene.targetEnd > scene.targetStart) {
    return scene.targetEnd - scene.targetStart;
  }
  return estimatedStarts(lines).reduce((a, x) => a + String(x.line.text).split(/\s+/).length / WORDS_PER_SEC + 0.5, 0);
}

/** The lines where a scene's n shots start, spread evenly by estimated time. */
function startLines(lines, n) {
  const est = estimatedStarts(lines);
  const span = est.length ? est.at(-1).start + 1 : 1;
  const picked = [];
  for (let k = 0; k < n; k += 1) {
    const want = (k * span) / n;
    const best = est.filter((x) => !picked.includes(x.line))
      .reduce((a, x) => (!a || Math.abs(x.start - want) < Math.abs(a.start - want) ? x : a), null);
    if (best) picked.push(best.line);
  }
  return picked.sort((a, b) => lines.indexOf(a) - lines.indexOf(b));
}

/**
 * Plan every scene's shots.
 * @returns {Array<{id: string, sceneId: string, startLineId: string, offsetSec: number, text: string, framing: string, suggested: boolean}>}
 */
export function planShots(script) {
  const shots = [];
  for (const scene of script.scenes) {
    const lines = script.lines.filter((l) => l.sceneId === scene.id);
    if (!lines.length) continue;
    const subjects = montageSubjects(scene.visual);
    const n = Math.max(1, Math.min(
      MAX_SHOTS_PER_SCENE,
      lines.length,
      subjects.length || Math.ceil(sceneSeconds(scene, lines) / SHOT_TARGET_SEC),
    ));
    const starts = startLines(lines, n);
    starts.forEach((line, i) => {
      shots.push({
        id: `sh${shots.length + 1}`,
        sceneId: scene.id,
        startLineId: line.id,
        offsetSec: 0,
        text: subjects.length ? subjects[i % subjects.length] : scene.visual || scene.title,
        montage: subjects.length > 0,
        framing: subjects.length ? "" : (n > 1 ? FRAMINGS[i % FRAMINGS.length] : ""),
        suggested: !scene.visual,
      });
    });
  }
  return shots;
}

/**
 * Where each shot plays, from the voice timeline. The first shot also covers
 * the opening title; the last runs to the end. seconds is what the clip must
 * fill, so the clip ordered is that long (4–12 s), slowed in the render when
 * a slot is longer than 12 s.
 */
export function shotSpans(shots, timeline) {
  const startOf = (shot) => {
    const line = timeline.lines.find((l) => l.id === shot.startLineId);
    return line ? Math.max(0, line.start + (Number(shot.offsetSec) || 0) - 0.25) : null;
  };
  const placed = shots.map((s) => ({ shot: s, at: startOf(s) })).filter((x) => x.at !== null);
  return placed.map((x, i) => {
    const from = i === 0 ? 0 : x.at;
    const to = i === placed.length - 1 ? timeline.total : placed[i + 1].at;
    return { id: x.shot.id, from: +from.toFixed(3), to: +to.toFixed(3), seconds: +(to - from).toFixed(3) };
  });
}
