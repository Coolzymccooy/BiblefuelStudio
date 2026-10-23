import { parseSceneScript } from "./parse.js";
import { defaultCast } from "./cast.js";
import { planShots, mentionsLead, DEFAULT_LEAD_MAN, DEFAULT_PEOPLE_NOTE, STYLE_SUFFIX } from "./shots.js";

/**
 * Turn pasted markdown into the fields of a new scene-script project:
 * the parsed script, a default cast, a lead character, planned shots and
 * empty voice/shot/render state.
 */

export const MAX_MARKDOWN_CHARS = 40_000;

function defaultLead(script) {
  const visuals = script.scenes.map((s) => s.visual).join(" ");
  const named = script.scenes.some((s) => mentionsLead(s.visual));
  if (named && /\b(man|he|his)\b/i.test(visuals) && !/\b(woman|she|her)\b/i.test(visuals.replace(/\bmother\b.*$/i, ""))) {
    return { descriptor: DEFAULT_LEAD_MAN, needed: false };
  }
  return { descriptor: "", needed: named };
}

export function projectFromMarkdown(markdown) {
  const { script, warnings } = parseSceneScript(markdown);
  const lead = defaultLead(script);
  if (lead.needed) {
    warnings.push({ code: "LEAD_NEEDED", message: "Describe the main character so they look the same in every shot." });
  }
  return {
    source: { markdown, parsedAt: Date.now(), used: script.source.used, ignored: script.source.ignored, warnings },
    meta: script.meta,
    scenes: script.scenes,
    lines: script.lines.map((l) => ({ ...l, audio: null })),
    speakers: script.speakers,
    voiceHints: script.voiceHints,
    music: { cues: script.music.cues.map((c) => ({ ...c, bed: null, offsetSec: 0 })), drops: script.music.drops },
    endCard: script.endCard,
    cast: defaultCast(script),
    look: { lead: lead.descriptor, peopleNote: DEFAULT_PEOPLE_NOTE, style: STYLE_SUFFIX },
    captions: { enabled: true },
    shots: planShots(script).map((s) => ({ ...s, clip: null })),
    timeline: null,
    voice: { status: "idle" },
    shotRun: { status: "idle" },
    render: { status: "idle" },
  };
}
