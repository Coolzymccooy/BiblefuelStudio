/**
 * Pick a long-form template from a rough idea. Deliberately simple and
 * explainable — the response tells the operator why, and they can override.
 */
const HOUR_CUES = /\b(an?\s+hour|1\s*hour|60\s*min(ute)?s?|hour[- ]long|all night|night shift)\b/i;

export function suggestTemplate(idea) {
  const text = String(idea || "");
  if (HOUR_CUES.test(text)) return { templateId: "sleep-60", reason: "the idea mentions an hour-long session" };
  return { templateId: "sleep-30", reason: "default 30-minute sleep session" };
}
