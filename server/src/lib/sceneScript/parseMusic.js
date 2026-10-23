/**
 * Music cues from a scene script: the "## Music and sound direction" rows
 * ("0:00–0:27 | Emotional reflection" plus notes), drops ("Drop the
 * instrumentals briefly before “BUT BY THE GRACE OF GOD!”"), heartbeat
 * percussion, and scene visuals that soften the music ("Music softens to
 * piano and choir."). Times here are the script's own targets; the real
 * times come from the voice timeline later.
 */

const CUE_RE = /^\*{0,2}(\d{1,2}:\d{2})\s*[–—-]\s*(\d{1,2}:\d{2})\*{0,2}\s*(?:[|:—–-]\s*)?(.*)$/;
const DROP_RE = /\bdrop\b[^.]*?\bbefore\s+["“](.+?)["”]/i;
const SOFTEN_RE = /[^.]*\bmusic\s+(softens|fades|quiets|drops)\b[^.]*\.?/i;

const toSec = (mmss) => {
  const [m, s] = String(mmss).split(":").map(Number);
  return m * 60 + s;
};
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function readRows(rows) {
  const cues = [];
  const used = [];
  const ignored = [];
  for (const { lineNo, text } of rows) {
    const m = CUE_RE.exec(text);
    if (m) {
      cues.push({ from: toSec(m[1]), to: toSec(m[2]), mood: m[3].replace(/\*\*/g, "").trim(), notes: "", lineNos: [lineNo] });
      used.push(lineNo);
    } else if (cues.length) {
      const cue = cues.at(-1);
      cue.notes = [cue.notes, text.replace(/\*\*/g, "").trim()].filter(Boolean).join(" ");
      used.push(lineNo);
    } else {
      ignored.push({ lineNo, text, reason: "commentary" });
    }
  }
  return { cues, used, ignored };
}

function cueFor(cues, scene, fallback) {
  if (scene.targetStart === null) return fallback;
  return cues.find((c) => scene.targetStart >= c.from && scene.targetStart < c.to) || fallback;
}

function assignScenes(cues, scenes) {
  let last = cues[0];
  for (const scene of scenes) {
    last = cueFor(cues, scene, last);
    if (last) last.sceneIds.push(scene.id);
  }
}

/** A scene whose visual says the music softens gets a cue of its own. */
function splitSoftenedScenes(cues, scenes) {
  const out = [];
  for (const cue of cues) {
    const softened = cue.sceneIds.filter((id) => SOFTEN_RE.test(scenes.find((s) => s.id === id)?.visual || ""));
    if (!softened.length || softened.length === cue.sceneIds.length) { out.push(cue); continue; }
    const first = scenes.find((s) => s.id === softened[0]);
    const kept = cue.sceneIds.filter((id) => !softened.includes(id));
    out.push({ ...cue, sceneIds: kept, to: first.targetStart ?? cue.to });
    out.push({
      from: first.targetStart, to: cue.to,
      mood: SOFTEN_RE.exec(first.visual)[0].trim(), notes: "", sceneIds: softened, lineNos: [],
    });
  }
  return out;
}

function perSceneCues(scenes) {
  return scenes.map((s) => ({ from: s.targetStart, to: s.targetEnd, mood: s.title, notes: "", sceneIds: [s.id], lineNos: [] }));
}

function readDrops(cues, lines, warnings) {
  const drops = [];
  for (const cue of cues) {
    const m = DROP_RE.exec(cue.notes);
    if (!m) continue;
    const phrase = norm(m[1]);
    const line = lines.find((l) => norm(l.text) === phrase) || lines.find((l) => phrase && norm(l.text).includes(phrase));
    if (line) drops.push({ beforeLineId: line.id, phrase: m[1] });
    else warnings.push({ code: "DROP_NOT_FOUND", message: `The music drop before "${m[1]}" matches no spoken line.` });
  }
  return drops;
}

/**
 * @returns {{ cues: object[], drops: object[], used: number[], ignored: object[], warnings: object[] }}
 */
export function buildMusic(rows, scenes, lines) {
  const warnings = [];
  const { cues: read, used, ignored } = readRows(rows);
  let cues;
  if (read.length) {
    cues = read.map((c) => ({ ...c, sceneIds: [] }));
    assignScenes(cues, scenes);
    cues = splitSoftenedScenes(cues.filter((c) => c.sceneIds.length), scenes);
  } else {
    cues = perSceneCues(scenes);
  }
  const drops = readDrops(cues, lines, warnings);
  const shaped = cues.map(({ lineNos, ...c }, i) => ({
    id: `m${i + 1}`,
    ...c,
    sfx: /heartbeat|pulse/i.test(`${c.mood} ${c.notes}`) ? ["heartbeat"] : [],
  }));
  return { cues: shaped, drops, used, ignored, warnings };
}
