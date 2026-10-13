import { z } from "zod";
import { getEffect } from "./effects/index.js";
import { STYLE_IDS } from "./styles.js";

/**
 * The motion plan: the one contract between the director, the renderer and
 * (later) "Open in Timeline". A plan that passes validatePlan renders.
 */
export const OUTPUT = Object.freeze({ w: 1080, h: 1920, fps: 30 });
const EPS = 1e-6;

const unit = z.number().min(0).max(1);
const shotSchema = z.object({
  start: z.number().min(0),
  // min(0), not positive(): an end at or before the start is reported by the
  // clearer "ends before it starts" check below.
  end: z.number().min(0),
  photo: z.number().int().min(0),
  role: z.enum(["open", "body", "end"]),
  move: z.object({ id: z.string(), intensity: unit }),
  entrance: z.object({ id: z.string() }),
  overlays: z.array(z.object({ id: z.string() })).max(2),
  anchor: z.object({ x: unit, y: unit }),
});
const captionSchema = z.object({
  text: z.string().trim().min(1).max(60),
  start: z.number().min(0),
  end: z.number().positive(),
  // reveal is a duration; holdUntil is an absolute time inside the caption's window (checked below).
  reveal: z.number().positive().finite(),
  holdUntil: z.number().finite(),
  effect: z.string().optional(),
});
const planSchema = z.object({
  version: z.literal(1),
  w: z.literal(OUTPUT.w),
  h: z.literal(OUTPUT.h),
  fps: z.literal(OUTPUT.fps),
  durationSec: z.number().positive().max(61),
  seed: z.number().int().min(0),
  style: z.enum(STYLE_IDS),
  energy: unit,
  shots: z.array(shotSchema).min(1).max(240),
  captions: z.array(captionSchema).max(9),
});

function kindError(id, kind, label) {
  return getEffect(id)?.kind === kind ? null : `${label}: ${kind} "${id}" is not a known ${kind}`;
}

/**
 * `shapes` (optional): each photo's shape, 'tall' or 'wide'. When given, a
 * shot whose move can't take its photo's shape (a squashed wide photo, a
 * frozen tall pan) is rejected.
 */
export function validatePlan(plan, { photoCount, shapes } = {}) {
  if (!Number.isInteger(photoCount) || photoCount < 1) {
    return { ok: false, errors: ["photoCount must be a positive integer"] };
  }
  if (shapes !== undefined && (!Array.isArray(shapes) || shapes.length !== photoCount || shapes.some((s) => s !== "tall" && s !== "wide"))) {
    return { ok: false, errors: [`shapes must list "tall" or "wide" for each of the ${photoCount} photos`] };
  }
  const parsed = planSchema.safeParse(plan);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const p = parsed.data;
  const errors = [];
  p.shots.forEach((s, i) => {
    const label = `shot ${i}`;
    if (s.end <= s.start) errors.push(`${label} ends before it starts`);
    if (i === 0 && Math.abs(s.start) > EPS) errors.push(`${label} must start at 0`);
    if (i > 0 && Math.abs(s.start - p.shots[i - 1].end) > EPS) errors.push(`${label} is not contiguous with the shot before`);
    if (s.photo >= photoCount) errors.push(`${label} uses photo ${s.photo}, but there are ${photoCount}`);
    const shape = shapes?.[s.photo];
    const moveShapes = getEffect(s.move.id)?.shapes;
    if (shape && moveShapes && !moveShapes.includes(shape)) errors.push(`${label}: move "${s.move.id}" doesn't suit a ${shape} photo`);
    for (const e of [kindError(s.move.id, "move", label), kindError(s.entrance.id, "entrance", label),
      ...s.overlays.map((o) => kindError(o.id, "overlay", label))]) if (e) errors.push(e);
  });
  if (Math.abs(p.shots.at(-1).end - p.durationSec) > EPS) errors.push(`the last shot must end at durationSec (${p.durationSec})`);
  p.captions.forEach((c, i) => {
    if (c.end <= c.start || c.end > p.durationSec + EPS) errors.push(`caption ${i} must sit inside 0..durationSec`);
    if (c.holdUntil < c.start - EPS || c.holdUntil > p.durationSec + EPS) {
      errors.push(`caption ${i} must hold until a time inside its own start..durationSec`);
    }
    if (i > 0 && c.start < p.captions[i - 1].end - EPS) errors.push(`caption ${i} and the one before overlap`);
  });
  return errors.length ? { ok: false, errors } : { ok: true, plan: p };
}
