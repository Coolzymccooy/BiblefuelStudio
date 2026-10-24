import { randomInt } from "crypto";
import { parseCartoonScript } from "./parse.js";
import { planShots, checkFilm } from "./plan.js";
import { styleId } from "./styles.js";
import { suggestBed } from "../sceneScript/music.js";
import { estimateTokens, usdForTokens } from "../videoGen/spend.js";
import { SEEDANCE_MODELS, seedanceRatio } from "../videoGen/providers/seedance.js";
import { benchmarkUsd, canRefetch } from "../sceneScript/shotStage.js";

/**
 * The stored cartoon project (spec section 7.4) and what ordering it would
 * cost. `cartoonFromScript` only builds the object; the cartoon store writes
 * it. The script text is kept verbatim in `source.markdown`, so spoken lines
 * are always the admin's own words.
 */

/** What a cast member has before a portrait is made: no look-alike picture, not approved. */
export const CAST_DEFAULTS = Object.freeze({ look: "", voice: "", portrait: null, approved: false, shelfId: null });

/** US$ for one Gemini character portrait (about four cents). */
export const IMAGE_USD = 0.04;

const MAX_SEED = 2147483647;
const BED_MOOD = "gentle warm hopeful";
const CLIP_RESOLUTION = "720p";

/** Names that would reach Object.prototype as object keys; never used as a character name. */
export const RESERVED_NAMES = Object.freeze(["__proto__", "constructor", "prototype"]);
export const isReservedName = (name) => RESERVED_NAMES.includes(name);
const reservedWarning = (name) => `"${name}" can't be used as a character name. Rename the character.`;

/**
 * Cast keyed by name: the Cast list first, then any speaker the list left out
 * (with an empty look). Built in a Map and looked up by own key only, so a
 * name such as "toString" is an ordinary character. A reserved name is left
 * out of the cast with a warning (its lines stay in the shots, where the
 * router refuses them).
 */
function buildCast(parsed, warnings) {
  const cast = new Map();
  // A name listed twice in Cast keeps its later entry; a speaker never replaces a listed member.
  const add = (name, member, { replace = false } = {}) => {
    if (cast.has(name) && !replace) return;
    if (isReservedName(name)) {
      const warning = reservedWarning(name);
      if (!warnings.includes(warning)) warnings.push(warning);
      return;
    }
    cast.set(name, member);
  };
  for (const member of parsed.cast) add(member.name, { ...CAST_DEFAULTS, ...member }, { replace: true });
  for (const scene of parsed.scenes) {
    for (const beat of scene.beats) {
      if (beat.kind === "line") add(beat.speaker, { ...CAST_DEFAULTS, name: beat.speaker });
    }
  }
  // fromEntries defines own properties, so no name can set the prototype.
  return Object.fromEntries(cast);
}

/** Speakers of the project's shots whose names can't be used: the film can't be made until they are renamed. */
export function reservedSpeakers(project) {
  return [...new Set((project?.shots || []).map((s) => s.speaker).filter(isReservedName))];
}

/** Parses a script and plans its shots; returns the stored project plus the length `check` and `warnings`. */
export function cartoonFromScript(markdown, { now = new Date() } = {}) {
  const parsed = parseCartoonScript(markdown);
  const shots = planShots(parsed);
  const scenes = parsed.scenes.map(({ id, place, note }) => ({ id, place, note }));
  const warnings = [...parsed.warnings];
  const cast = buildCast(parsed, warnings);
  return {
    mode: "cartoon",
    meta: { title: parsed.title, verse: { reference: parsed.verse, text: "" }, aspect: "portrait", style: styleId(parsed.style) },
    source: { markdown: typeof markdown === "string" ? markdown : "", ignored: parsed.ignored, warnings, parsedAt: now.toISOString() },
    cast,
    scenes,
    shots: shots.map((shot) => ({ ...shot, clip: null })),
    shotListApproved: false,
    seed: randomInt(1, MAX_SEED + 1),
    music: { bed: suggestBed({ mood: BED_MOOD }) },
    captions: { enabled: true },
    endCard: { text: "" },
    spentUsd: 0,
    render: { status: "idle" },
    check: checkFilm(shots, scenes),
    warnings,
  };
}

/** A failed clip that was paid for and can still be fetched; a re-wait that ended in a definite failure set `refetchable: false`. */
const clipCanRefetch = (clip, now) => Boolean(clip) && clip.refetchable !== false && canRefetch({ clip }, now);

/**
 * Whether ordering this shot again only fetches a clip already paid for, at no
 * cost (as Human mode's estimate does): a paid clip whose download failed, or,
 * on a done shot, a paid re-make whose download failed (kept on `clip.remake`).
 */
export function fetchesAgain(shot, now = Date.now()) {
  const clip = shot?.clip;
  if (clip?.status === "done") return Boolean(clip.remake) && clipCanRefetch({ ...clip.remake, status: "error" }, now);
  return clipCanRefetch(clip, now);
}

/** The shots an order would cover: the named ones, else every shot without a finished clip. */
function shotsToOrder(project, only) {
  const wanted = Array.isArray(only) && only.length ? new Set(only) : null;
  return project.shots.filter((shot) => (wanted ? wanted.has(shot.id) : shot.clip?.status !== "done"));
}

/**
 * What ordering would cost: the clips still to make, the portraits still to
 * draw, and the spend so far. A shot that only fetches a paid clip again is
 * counted in `refetch` and costs nothing.
 */
export function estimateFilm(project, only) {
  const picked = shotsToOrder(project, only);
  const shots = picked.filter((shot) => !fetchesAgain(shot));
  const ratio = seedanceRatio(project.meta?.aspect);
  const seconds = shots.reduce((sum, shot) => sum + shot.seconds, 0);
  const tokens = shots.reduce((sum, shot) => sum + estimateTokens({ durationSec: shot.seconds, ratio, resolution: CLIP_RESOLUTION }), 0);
  const usd = usdForTokens({ model: SEEDANCE_MODELS.mini, resolution: CLIP_RESOLUTION, tokens });
  const images = Object.values(project.cast || {}).filter((member) => !(member.approved && member.portrait)).length;
  const spentUsd = Number(project.spentUsd) || 0;
  const benchmark = benchmarkUsd();
  const totalUsd = spentUsd + usd;
  return {
    clips: shots.length,
    refetch: picked.length - shots.length,
    seconds,
    usd,
    images,
    imageUsd: images * IMAGE_USD,
    spentUsd,
    totalUsd,
    benchmarkUsd: benchmark,
    overBenchmark: totalUsd > benchmark + 1e-9,
    shotIds: picked.map((shot) => shot.id),
  };
}
