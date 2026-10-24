import { randomInt } from "crypto";
import { parseCartoonScript } from "./parse.js";
import { planShots, checkFilm } from "./plan.js";
import { styleId } from "./styles.js";
import { suggestBed } from "../sceneScript/music.js";
import { estimateTokens, usdForTokens } from "../videoGen/spend.js";
import { SEEDANCE_MODELS, seedanceRatio } from "../videoGen/providers/seedance.js";
import { benchmarkUsd } from "../sceneScript/shotStage.js";

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

/** Cast keyed by name: the Cast list first, then any speaker the list left out (with an empty look). */
function buildCast(parsed) {
  const cast = {};
  for (const member of parsed.cast) cast[member.name] = { ...CAST_DEFAULTS, ...member };
  for (const scene of parsed.scenes) {
    for (const beat of scene.beats) {
      if (beat.kind === "line" && !cast[beat.speaker]) cast[beat.speaker] = { ...CAST_DEFAULTS, name: beat.speaker };
    }
  }
  return cast;
}

/** Parses a script and plans its shots; returns the stored project plus the length `check` and `warnings`. */
export function cartoonFromScript(markdown, { now = new Date() } = {}) {
  const parsed = parseCartoonScript(markdown);
  const shots = planShots(parsed);
  const scenes = parsed.scenes.map(({ id, place, note }) => ({ id, place, note }));
  return {
    mode: "cartoon",
    meta: { title: parsed.title, verse: { reference: parsed.verse, text: "" }, aspect: "portrait", style: styleId(parsed.style) },
    source: { markdown: typeof markdown === "string" ? markdown : "", ignored: parsed.ignored, warnings: parsed.warnings, parsedAt: now.toISOString() },
    cast: buildCast(parsed),
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
    warnings: parsed.warnings,
  };
}

/** The shots an order would cover: the named ones, else every shot without a finished clip. */
function shotsToOrder(project, only) {
  const wanted = Array.isArray(only) && only.length ? new Set(only) : null;
  return project.shots.filter((shot) => (wanted ? wanted.has(shot.id) : shot.clip?.status !== "done"));
}

/** What ordering would cost: the clips still to make, the portraits still to draw, and the spend so far. */
export function estimateFilm(project, only) {
  const shots = shotsToOrder(project, only);
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
    seconds,
    usd,
    images,
    imageUsd: images * IMAGE_USD,
    spentUsd,
    totalUsd,
    benchmarkUsd: benchmark,
    overBenchmark: totalUsd > benchmark + 1e-9,
    shotIds: shots.map((shot) => shot.id),
  };
}
