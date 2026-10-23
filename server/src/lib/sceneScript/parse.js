import { referenceOfLine } from "./reference.js";
import { readAdvice } from "./parseAdvice.js";
import { buildMusic } from "./parseMusic.js";

/**
 * Scene-script parser: a cinematic script as chat assistants write it
 * (scenes with timestamps, *Visual:* directions, **Narrator (tone):** tags,
 * quoted lines, a music section and recommendations) into plain JSON.
 *
 * Deterministic, no LLM, no I/O. Spoken text is the author's words with only
 * markup and quote marks removed (the verbatim contract, spec 4.2). Every
 * non-blank source line ends up in source.used or source.ignored, so the
 * preview can show what was left out.
 */

export const DEFAULT_SPEAKERS = Object.freeze(["Narrator", "Scripture", "Ensemble"]);

const SCENE_RE = /^scene\s+(\d+)\s*(?:[—–:.-]\s*(.*?))?\s*(?:\((\d{1,2}:\d{2})\s*[–—-]\s*(\d{1,2}:\d{2})\))?\s*$/i;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const IMAGE_LINK_RE = /^!?\[[^\]]*\]\([^)]*\)$/;
const RULE_RE = /^(?:-{3,}|\*{3,}|_{3,})$/;
// No spoken line or direction is this long; a longer one is set aside so a
// pasted blob cannot keep the parser busy.
const MAX_LINE_CHARS = 2000;
const RESERVED_TAGS = new Set([
  "visual", "visuals", "final screen", "end card", "end screen", "music", "sound", "sfx", "title",
  "note", "notes", "camera", "transition", "on screen", "on-screen text", "text", "caption",
]);
// Scripture is a cast member inside a scene. The header line "Scripture: <ref>"
// is read by readHeaderLine before any scene starts, so it never reaches speakerTag.
const ROLE_WORDS = /^(narrator|voice|reader|child|children|choir|ensemble|man|woman|boy|girl|paul|jesus|god|pastor|speaker|host|scripture)\b/i;

const toSec = (mmss) => {
  const [m, s] = String(mmss).split(":").map(Number);
  return m * 60 + s;
};

/** "GRACE MADE ME" -> "Grace Made Me"; mixed case is left as written. */
export function displayTitle(text) {
  const t = String(text || "").trim();
  if (!t || t !== t.toUpperCase()) return t;
  const small = new Set(["a", "an", "and", "the", "of", "in", "on", "by", "to", "for", "is"]);
  return t.toLowerCase().split(/\s+/).map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
}

/** Remove bold/italic/code markers and outer quote marks. */
export function stripMarkup(text) {
  return String(text || "").replace(/\*\*|__|`/g, "").replace(/^\*+|\*+$/g, "").trim();
}

function unwrapItalic(line) {
  return line.replace(/\*\*/g, "").replace(/^\*(.*)\*$/, "$1").replace(/^_(.*)_$/, "$1").trim();
}

function newState() {
  return {
    section: "preamble",
    meta: { title: "", reference: "", targetSec: null, aspect: "portrait", notes: [] },
    scenes: [], lines: [], speakers: [...DEFAULT_SPEAKERS],
    endCard: null, musicRows: [], adviceRows: [],
    used: [], ignored: [], warnings: [],
    scene: null, speaker: null, inQuote: false,
  };
}

const use = (st, lineNo) => st.used.push(lineNo);
const ignore = (st, lineNo, text, reason) => st.ignored.push({ lineNo, text, reason });

function readHeaderLine(st, lineNo, text) {
  const plain = stripMarkup(text);
  const title = /^title\s*:\s*(.+)$/i.exec(plain);
  if (title) {
    const [name, ...rest] = title[1].split("|").map((x) => x.trim());
    st.meta.title = displayTitle(name);
    const ref = rest.map(referenceOfLine).find(Boolean);
    if (ref && !st.meta.reference) st.meta.reference = ref.canonical;
    st.section = "header";
    return use(st, lineNo);
  }
  const scripture = /^scripture\s*:\s*(.+)$/i.exec(plain);
  if (scripture && referenceOfLine(scripture[1])) {
    st.meta.reference = referenceOfLine(scripture[1]).canonical;
    return use(st, lineNo);
  }
  if (st.section !== "header") return ignore(st, lineNo, text, "commentary");
  const secs = /(\d+)\s*-?\s*(second|sec|minute|min)/i.exec(plain);
  if (secs) st.meta.targetSec = Number(secs[1]) * (/^min/i.test(secs[2]) ? 60 : 1);
  if (/\b16:9\b/.test(plain)) st.meta.aspect = "landscape";
  if (/\b(9:16|16:9|1:1)\b/.test(plain) && /\b1:1\b/.test(plain)) st.meta.aspect = "square";
  st.meta.notes.push(plain);
  return use(st, lineNo);
}

function readHeading(st, lineNo, level, text) {
  const plain = stripMarkup(text);
  const scene = SCENE_RE.exec(plain);
  if (scene) return startScene(st, lineNo, scene);
  use(st, lineNo);
  st.scene = null;
  if (/music|sound|score|audio/i.test(plain)) st.section = "music";
  else if (/recommend|what would make|tips|production|direction notes|why (this|it) works/i.test(plain)) st.section = "advice";
  else if (st.section === "preamble" || st.section === "header") {
    if (level === 1 && !st.meta.title) st.meta.title = displayTitle(plain);
    if (/script/i.test(plain) || level === 1) st.section = "header";
  } else st.section = "other";
}

function startScene(st, lineNo, m) {
  use(st, lineNo);
  const scene = {
    id: `s${st.scenes.length + 1}`,
    number: Number(m[1]),
    title: stripMarkup(m[2] || `Scene ${m[1]}`).replace(/\s*\(.*\)\s*$/, ""),
    targetStart: m[3] ? toSec(m[3]) : null,
    targetEnd: m[4] ? toSec(m[4]) : null,
    visual: "",
    noSpeakerWarned: false,
  };
  st.scenes.push(scene);
  st.scene = scene;
  st.section = "scene";
  st.speaker = null;
  st.inQuote = false;
}

// A speaker tag is short; only the text after it can be long. The tag
// regexes see the head alone, so a long run of spaces cannot make them
// backtrack for seconds.
const TAG_HEAD_CHARS = 160;

function speakerTag(line) {
  const close = line.startsWith("**") ? line.indexOf("**", 2) : -1;
  const headEnd = close >= 0 ? close + 2 : line.indexOf(":") + 1;
  if (headEnd <= 0 || headEnd > TAG_HEAD_CHARS) return null;
  const head = line.slice(0, headEnd).replace(/\s+/g, " ");
  const tail = line.slice(headEnd);
  const bold = /^\*\* ?([^*:()]{1,40}?) ?(?:\(([^)]*)\))? ?:? ?\*\*$/.exec(head);
  const plain = /^([A-Z][A-Za-z .'’-]{0,30}?) ?(?:\(([^)]*)\))? ?:$/.exec(head);
  if (bold) bold[3] = tail.replace(/^\s*:?/, "");
  if (plain) plain[3] = tail;
  const m = bold && /:/.test(line.slice(0, line.indexOf("**", 2) + 3)) ? bold : plain;
  if (!m) return null;
  const name = m[1].trim();
  if (RESERVED_TAGS.has(name.toLowerCase())) return null;
  const rest = (m[3] || "").trim();
  if (m === plain && !(ROLE_WORDS.test(name) || m[2]) ) return null;
  if (m === plain && rest && !/^["“]/.test(rest)) return null;
  return { name: displayTitle(name.replace(/\b\w/g, (c) => c.toUpperCase())), tone: m[2] ? m[2].trim() : null, rest };
}

function addSpeaker(st, name) {
  if (!st.speakers.includes(name)) st.speakers.push(name);
}

/** Quote state and emphasis for one spoken row. Returns null when nothing is left to say. */
function spokenParts(st, raw) {
  let s = raw.trim();
  let opened = false;
  let closed = false;
  const peel = () => {
    if (/^["“]/.test(s)) { opened = true; s = s.slice(1).trim(); }
    if (/["”]$/.test(s)) { closed = true; s = s.slice(0, -1).trim(); }
  };
  peel();
  let emphasis = false;
  const bold = /^\*\*(.+)\*\*$/.exec(s);
  if (bold) { emphasis = true; s = bold[1].trim(); peel(); }
  if (opened && !closed) st.inQuote = true;
  else if (closed) st.inQuote = false;
  s = s.replace(/\*\*/g, "").replace(/__/g, "").trim();
  if (!s) return null;
  const quote = /^['‘](.+)['’]$/s.exec(s);
  if (quote) return { text: quote[1].trim(), emphasis, kind: "scripture" };
  const ref = referenceOfLine(s);
  if (ref) return { text: s, emphasis: false, kind: "reference", reference: ref.canonical };
  return { text: s, emphasis, kind: "narration" };
}

function addSpoken(st, lineNo, raw) {
  const parts = spokenParts(st, raw);
  if (!parts) return ignore(st, lineNo, raw, "empty");
  use(st, lineNo);
  const scene = st.scene;
  if (!st.speaker && !scene.noSpeakerWarned) {
    scene.noSpeakerWarned = true;
    st.warnings.push({ code: "NO_SPEAKER", sceneId: scene.id, message: `Scene ${scene.number} has words with no speaker tag. The narrator will read them.` });
  }
  const speaker = parts.kind === "scripture" ? "Scripture" : st.speaker?.name || "Narrator";
  st.lines.push({
    id: `l${st.lines.length + 1}`,
    sceneId: scene.id,
    speaker,
    tone: parts.kind === "scripture" ? null : st.speaker?.tone ?? null,
    kind: parts.kind,
    text: parts.text,
    emphasis: parts.emphasis,
    ...(parts.reference ? { reference: parts.reference } : {}),
    sourceLine: lineNo,
  });
}

function readFinalScreen(st, body) {
  const parts = body.split(/\s+[—–|]\s+|\s+-\s+/).map((x) => x.trim()).filter(Boolean);
  if (parts.length > 1 && referenceOfLine(parts[0])) {
    st.endCard = { reference: parts[0], text: parts.slice(1).join(" — ") };
  } else {
    st.endCard = { reference: "", text: body.trim() };
  }
}

function readSceneLine(st, lineNo, raw) {
  const flat = unwrapItalic(raw);
  if (!st.inQuote) {
    const visual = /^visuals?\s*:\s*(.+)$/i.exec(flat);
    if (visual) {
      st.scene.visual = [st.scene.visual, visual[1].trim()].filter(Boolean).join(" ");
      return use(st, lineNo);
    }
    const final = /^(?:final screen|end card|end screen)\s*:\s*(.+)$/i.exec(flat);
    if (final) { readFinalScreen(st, final[1]); return use(st, lineNo); }
    if (/^(?:music|sound|sfx)\s*:/i.test(flat)) return ignore(st, lineNo, raw, "music note");
    const tag = speakerTag(raw);
    if (tag) {
      st.speaker = { name: tag.name, tone: tag.tone };
      addSpeaker(st, tag.name);
      if (!tag.rest) return use(st, lineNo);
      return addSpoken(st, lineNo, tag.rest);
    }
    if (/^\(.*\)$/.test(raw) || /^\[.*\]$/.test(raw) || /^\*[^*].*[^*]\*$/.test(raw)) {
      return ignore(st, lineNo, raw, "stage direction");
    }
  }
  return addSpoken(st, lineNo, raw);
}

function readLine(st, lineNo, raw) {
  const line = raw.trim();
  if (!line) return;
  if (IMAGE_LINK_RE.test(line)) return ignore(st, lineNo, raw, "image link");
  if (RULE_RE.test(line)) return ignore(st, lineNo, raw, "divider");
  const heading = HEADING_RE.exec(line);
  if (heading) return readHeading(st, lineNo, heading[1].length, heading[2]);
  const bareScene = SCENE_RE.exec(stripMarkup(line));
  if (bareScene && !st.inQuote) return startScene(st, lineNo, bareScene);
  switch (st.section) {
    case "scene": return readSceneLine(st, lineNo, line);
    case "music": st.musicRows.push({ lineNo, text: line }); return undefined;
    case "advice": st.adviceRows.push({ lineNo, text: line }); return undefined;
    case "other": return ignore(st, lineNo, raw, "commentary");
    default: return readHeaderLine(st, lineNo, line);
  }
}

function placeChants(st, chantText) {
  if (!chantText || !st.scenes.length) return;
  const chant = (sceneId, n) => ({ id: `c${n}`, sceneId, speaker: "Ensemble", tone: null, kind: "chant", text: chantText, emphasis: false, sourceLine: null });
  const anchor = st.lines.findIndex((l) => l.kind === "reference");
  const after = anchor >= 0 ? anchor : st.lines.findIndex((l) => l.kind === "scripture");
  if (after >= 0) st.lines.splice(after + 1, 0, chant(st.lines[after].sceneId, 1));
  st.lines.push(chant(st.scenes.at(-1).id, after >= 0 ? 2 : 1));
}

function finishWarnings(st) {
  if (!st.scenes.length) {
    st.warnings.push({ code: "NO_SCENES", message: "No scenes were found. Start each scene with a line such as \"Scene 1 — The Hook (0:00–0:12)\"." });
  }
  st.scenes.forEach((s, i) => {
    if (!s.visual) st.warnings.push({ code: "NO_VISUAL", sceneId: s.id, message: `Scene ${s.number} has no Visual line. A shot will be suggested for it.` });
    const prev = st.scenes[i - 1];
    if (prev && prev.targetEnd !== null && s.targetStart !== null && s.targetStart < prev.targetEnd) {
      st.warnings.push({ code: "OVERLAP", sceneId: s.id, message: `Scene ${s.number} starts before scene ${prev.number} ends.` });
    }
  });
}

/**
 * @param {string} markdown
 * @returns {{ script: object, warnings: Array<{code: string, message: string, sceneId?: string}> }}
 */
export function parseSceneScript(markdown) {
  const st = newState();
  String(markdown || "").split(/\r?\n/).forEach((raw, i) => {
    if (raw.length > MAX_LINE_CHARS) {
      ignore(st, i + 1, raw.slice(0, 80), "line too long");
      st.warnings.push({ code: "LINE_TOO_LONG", message: `Line ${i + 1} is over ${MAX_LINE_CHARS} characters and was left out. Split it into shorter lines.` });
      return;
    }
    // One space per run keeps every pattern below linear in practice.
    readLine(st, i + 1, raw.replace(/[ \t]+/g, " "));
  });
  const advice = readAdvice(st.adviceRows);
  for (const lineNo of advice.used) use(st, lineNo);
  for (const x of advice.ignored) ignore(st, x.lineNo, x.text, "commentary");
  placeChants(st, advice.chantText);
  const music = buildMusic(st.musicRows, st.scenes, st.lines);
  for (const lineNo of music.used) use(st, lineNo);
  for (const x of music.ignored) ignore(st, x.lineNo, x.text, x.reason);
  st.warnings.push(...music.warnings);
  finishWarnings(st);
  const script = {
    meta: st.meta,
    scenes: st.scenes.map(({ noSpeakerWarned, ...s }) => s),
    lines: st.lines,
    speakers: st.speakers.map((name) => ({ name })),
    voiceHints: advice.voiceHints,
    music: { cues: music.cues, drops: music.drops },
    endCard: st.endCard,
    source: { used: [...new Set(st.used)].sort((a, b) => a - b), ignored: st.ignored.sort((a, b) => a.lineNo - b.lineNo) },
  };
  return { script, warnings: st.warnings };
}
