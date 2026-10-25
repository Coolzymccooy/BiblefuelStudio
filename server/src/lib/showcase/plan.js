import { z } from "zod";
import { captionSchema } from "../motion/plan.js";
import { SHOWCASE_IDS } from "../motion/styles.js";
import { TEMPLATES, SHOWCASE_FPS, SHAPES } from "./templates.js";

/**
 * The Showcase plan: the contract between the Showcase director and its
 * renderer. A plan that passes validateShowcasePlan renders.
 */
const EPS = 1e-6;
const TEMPLATE_IDS = Object.keys(TEMPLATES);

const sceneSchema = z.object({
  template: z.enum(TEMPLATE_IDS),
  photos: z.array(z.number().int().min(0)).min(1).max(5),
  start: z.number().min(0),
  end: z.number().min(0),
});
const planSchema = z.object({
  version: z.literal(1),
  kind: z.literal("showcase"),
  w: z.number().int(),
  h: z.number().int(),
  fps: z.literal(SHOWCASE_FPS),
  durationSec: z.number().positive().max(181),
  seed: z.number().int().min(0),
  style: z.enum(SHOWCASE_IDS),
  energy: z.number().min(0).max(1),
  shape: z.enum(["tall", "wide"]),
  /** The beat the templates time their entrances to. */
  beatSec: z.number().positive().max(4),
  scenes: z.array(sceneSchema).min(1).max(400),
  captions: z.array(captionSchema).max(20),
  invite: z.object({ month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(31), label: z.string() }).nullable(),
  flashes: z.array(z.number().min(0)),
});

export function validateShowcasePlan(plan, { photoCount } = {}) {
  if (!Number.isInteger(photoCount) || photoCount < 1) {
    return { ok: false, errors: ["photoCount must be a positive integer"] };
  }
  const parsed = planSchema.safeParse(plan);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const p = parsed.data;
  const errors = [];
  const frame = SHAPES[p.shape];
  if (p.w !== frame.w || p.h !== frame.h) errors.push(`a ${p.shape} plan's frame must be ${frame.w}x${frame.h}`);
  p.scenes.forEach((s, i) => {
    const label = `scene ${i}`;
    if (s.end <= s.start) errors.push(`${label} ends before it starts`);
    if (i === 0 && Math.abs(s.start) > EPS) errors.push(`${label} must start at 0`);
    if (i > 0 && Math.abs(s.start - p.scenes[i - 1].end) > EPS) errors.push(`${label} is not contiguous with the scene before`);
    const want = TEMPLATES[s.template].photos;
    if (s.photos.length !== want) errors.push(`${label}: ${s.template} shows ${want} photo${want === 1 ? "" : "s"}, not ${s.photos.length}`);
    for (const photo of s.photos) if (photo >= photoCount) errors.push(`${label} uses photo ${photo}, but there are ${photoCount}`);
  });
  if (Math.abs(p.scenes.at(-1).end - p.durationSec) > EPS) errors.push(`the last scene must end at durationSec (${p.durationSec})`);
  p.captions.forEach((c, i) => {
    if (c.end <= c.start || c.end > p.durationSec + EPS) errors.push(`caption ${i} must sit inside 0..durationSec`);
    if (c.holdUntil < c.start - EPS || c.holdUntil > p.durationSec + EPS) errors.push(`caption ${i} must hold until a time inside its own start..durationSec`);
    if (i > 0 && c.start < p.captions[i - 1].end - EPS) errors.push(`caption ${i} and the one before overlap`);
  });
  return errors.length ? { ok: false, errors } : { ok: true, plan: p };
}
