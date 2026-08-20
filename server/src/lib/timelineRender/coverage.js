// What a render actually included — and what it silently left out.
//
// The timeline UI offers six tracks (video, broll, voiceover, music, captions,
// effects) but the renderer composes only some of them, and caps others. A
// church dropping a music bed and captions onto the timeline previously got a
// render with neither and NO indication why. Silent omission is worse than a
// missing feature: it makes the output untrustworthy, because the operator
// cannot tell a deliberate choice from a bug.
//
// This module answers "what happened to my clips?" as data, so the route can
// return it and the UI can say so plainly.

/** Tracks the proof renderer can actually compose today. */
export const RENDERED_KINDS = Object.freeze(['video', 'broll', 'voiceover', 'music', 'captions']);

/** Tracks that exist in the UI but are not yet composed. */
export const UNRENDERED_KINDS = Object.freeze(['effects']);

/** Per-track caps the renderer applies. null = uncapped. */
export const TRACK_CAPS = Object.freeze({
  broll: null,
  voiceover: null,
  music: 1,
  captions: null,
});

const LABELS = Object.freeze({
  video: 'Real footage',
  broll: 'AI B-roll / cutaways',
  voiceover: 'Voice-over',
  music: 'Music bed',
  captions: 'Captions',
  effects: 'Effects',
});

function clipsOf(plan, kind) {
  return (plan?.tracks?.find((t) => t.kind === kind)?.clips) || [];
}

/**
 * Describe which clips made it into the render and which did not.
 *
 * @param {object} plan the timeline render plan
 * @returns {{
 *   included: Array<{kind:string,label:string,used:number,total:number}>,
 *   omitted: Array<{kind:string,label:string,count:number,reason:string}>,
 *   warnings: string[]
 * }}
 */
export function describeRenderCoverage(plan) {
  const included = [];
  const omitted = [];

  for (const kind of RENDERED_KINDS) {
    const clips = clipsOf(plan, kind);
    // What makes a clip usable depends on the track: caption clips carry TEXT
    // and never a media file, voice-over placeholders carry a prompt that is
    // synthesized at render time, and everything else needs a real path.
    const usable = clips.filter((c) => {
      if (!c) return false;
      if (kind === 'captions') return Boolean(String(c.text || '').trim());
      return Boolean(c.path || c.prompt);
    });
    const unusable = clips.length - usable.length;
    const cap = TRACK_CAPS[kind] ?? null;
    const used = cap == null ? usable.length : Math.min(cap, usable.length);

    if (used > 0) included.push({ kind, label: LABELS[kind], used, total: clips.length });

    if (cap != null && usable.length > used) {
      omitted.push({
        kind,
        label: LABELS[kind],
        count: usable.length - used,
        reason: `only the first ${cap} ${kind} clip${cap === 1 ? '' : 's'} is composed`,
      });
    }
    if (unusable > 0) {
      omitted.push({
        kind,
        label: LABELS[kind],
        count: unusable,
        reason: 'clip has no media file yet',
      });
    }
  }

  for (const kind of UNRENDERED_KINDS) {
    const clips = clipsOf(plan, kind);
    if (clips.length > 0) {
      omitted.push({
        kind,
        label: LABELS[kind],
        count: clips.length,
        reason: 'this track is not composed by the renderer yet',
      });
    }
  }

  const warnings = omitted.map(
    (o) => `${o.count} ${o.label} clip${o.count === 1 ? '' : 's'} not in this render — ${o.reason}.`,
  );

  return { included, omitted, warnings };
}
