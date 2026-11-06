/**
 * Mirror the page's "sidecar" state onto the timeline's own tracks.
 *
 * Two timeline models coexist on the Timeline page: the sidecar state the
 * panels edit (musicPaths, caption lines) and `documentaryProject.tracks`,
 * which is what the operator SEES in the strip. Only the first was ever fed to
 * the renderer, so adding a music bed or transcribing captions left the Music
 * bed and Captions lanes reading "0 clips" — the timeline disagreed with the
 * app about what the video contained.
 *
 * This projects the sidecar state onto those two lanes so the strip tells the
 * truth. It is PURE and IDEMPOTENT: same input, same project reference back, so
 * it is safe to call from an effect without looping.
 */
import type { TimelineProject, TimelineClip, TimelineAsset, TimelineWord } from './timelineProject';

/** The voice the captions should follow: where it sits, and its words if known. */
export interface SidecarVoice {
  startSec: number;
  durationSec: number;
  words?: TimelineWord[];
}

export interface SidecarState {
  musicPaths: string[];
  captionLines: string[];
  voice?: SidecarVoice | null;
}

/** Assets this module owns. Anything else on these lanes is left alone. */
const OWNED_TAG = 'sidecar-sync';

function fileLabel(path: string): string {
  return path.split(/[\/]/).pop() || 'audio';
}

/** Deterministic ids: identical input must produce an identical project. */
function assetId(kind: string, key: string): string {
  return `asset-${OWNED_TAG}-${kind}-${key}`;
}
function clipId(kind: string, key: string): string {
  return `clip-${OWNED_TAG}-${kind}-${key}`;
}

function buildMusic(paths: string[], targetSec: number) {
  const assets: TimelineAsset[] = [];
  const clips: TimelineClip[] = [];
  if (paths.length === 0) return { assets, clips };

  // Split the runtime evenly. The renderer decides actual playback order and
  // looping; the lane only has to show that music is present and in what order.
  const each = targetSec / paths.length;
  paths.forEach((path, i) => {
    const key = String(i);
    assets.push({
      id: assetId('music', key),
      kind: 'audio',
      source: 'upload',
      label: fileLabel(path),
      path,
      tags: [OWNED_TAG, 'music'],
    });
    clips.push({
      id: clipId('music', key),
      assetId: assetId('music', key),
      startSec: Math.round(each * i),
      durationSec: Math.round(each),
      transform: { fit: 'cover' },
    });
  });
  return { assets, clips };
}

/** Fail closed on spoken-text edits. Formatting/case/punctuation may change,
 * but insertion/deletion/replacement needs realignment, never positional reuse. */
const nonspokenCaptionToken = (token: string) => /^["'“”‘’()[\]{},.!?;:\-‐‑‒–—―…]+$/u.test(token);

/** Mirror captions.js: one lexical token per source unit, punctuation attached
 * to that unit without manufacturing timestamps. Partition by lexical counts,
 * not whitespace counts, so punctuation cannot steal the next line's word. */
function matchingWordLines(original: TimelineWord[], lines: string[]): TimelineWord[][] | null {
  const key = (token: string) => token.toLowerCase()
    .replace(/^["'“”‘’(\[\{,!?;:]+/u, '')
    .replace(/["'“”‘’)\]\},.!?;:]+$/u, '');
  let cursor = 0;
  const groups: TimelineWord[][] = [];
  for (const line of lines) {
    const tokens = line.trim().split(/\s+/).filter(Boolean);
    const lexical = tokens.map((token, index) => ({ token, index })).filter(({ token }) => !nonspokenCaptionToken(token));
    if (!lexical.length) return null;
    const group: TimelineWord[] = [];
    for (let i = 0; i < lexical.length; i++) {
      const w = original[cursor++];
      if (!w) return null;
      const parts = w.text.trim().split(/\s+/).filter(Boolean).filter((token) => !nonspokenCaptionToken(token));
      if (parts.length !== 1 || !key(parts[0]) || key(parts[0]) !== key(lexical[i].token) ||
          !Number.isFinite(w.startMs) || !Number.isFinite(w.endMs) || w.endMs <= w.startMs) return null;
      const start = i === 0 ? 0 : lexical[i].index;
      const end = i + 1 < lexical.length ? lexical[i + 1].index : tokens.length;
      group.push({ ...w, text: tokens.slice(start, end).join(' ') });
    }
    groups.push(group);
  }
  return cursor === original.length ? groups : null;
}

export function preserveMatchingWords(original: TimelineWord[], lines: string[]): TimelineWord[] | null {
  return matchingWordLines(original, lines)?.flat() ?? null;
}

/** Source audio clock -> composition clock, at the editor's supported 1x rate.
 * Keep source words immutable; splits share the asset and change sourceStartSec. */
export function composeVoiceTiming(project: TimelineProject): SidecarVoice | null {
  const clips = project.tracks.flatMap((t, trackIndex) =>
    t.kind !== 'voiceover' || t.hidden || t.muted ? [] :
      [...t.clips].sort((a, b) => a.startSec - b.startSec)
        .map((clip, clipIndex) => ({ clip, trackIndex, clipIndex })))
    .filter(({ clip }) => !clip.muted && project.assets[clip.assetId]?.path);
  if (!clips.length) return null;
  const startSec = Math.min(...clips.map(({ clip: c }) => c.startSec));
  const endSec = Math.max(...clips.map(({ clip: c }) => c.startSec + c.durationSec));
  // Carry provenance beside each transformed word until stitching is complete.
  // Text equality cannot identify a source word: repeats and other takes may
  // have identical text/times. Clip adjacency alone cannot identify a split.
  const fragments = clips.flatMap(({ clip: c, trackIndex, clipIndex }) => {
    const source = Math.max(0, c.sourceStartSec || 0) * 1000;
    const end = source + c.durationSec * 1000;
    return (project.assets[c.assetId].words || []).flatMap((w, wordIndex) =>
      w.endMs > source && w.startMs < end ? [{
        word: { ...w,
          startMs: (c.startSec - startSec) * 1000 + Math.max(source, w.startMs) - source,
          endMs: (c.startSec - startSec) * 1000 + Math.min(end, w.endMs) - source,
        },
        assetId: c.assetId, wordIndex, trackIndex, clipIndex,
        clipStart: c.startSec * 1000, clipEnd: (c.startSec + c.durationSec) * 1000,
        sourceStart: source, sourceEnd: end,
        fragmentStart: Math.max(source, w.startMs), fragmentEnd: Math.min(end, w.endMs),
      }] : []);
  }).filter(({ word: w }) => Number.isFinite(w.startMs) && Number.isFinite(w.endMs) && w.endMs > w.startMs)
    .sort((a, b) => a.word.startMs - b.word.startMs);
  const stitched: typeof fragments = [];
  // Sub-microsecond tolerance only for floating-point clock arithmetic, not
  // editorial gaps. Require BOTH source and composition continuity.
  const contiguous = (a: number, b: number) => Math.abs(a - b) < 0.000001;
  for (const next of fragments) {
    const prev = stitched[stitched.length - 1];
    if (prev && prev.assetId === next.assetId && prev.wordIndex === next.wordIndex &&
        prev.trackIndex === next.trackIndex && prev.clipIndex + 1 === next.clipIndex &&
        contiguous(prev.clipEnd, next.clipStart) && contiguous(prev.sourceEnd, next.sourceStart) &&
        contiguous(prev.fragmentEnd, next.fragmentStart) && contiguous(prev.word.endMs, next.word.startMs)) {
      prev.word.endMs = next.word.endMs;
      prev.clipIndex = next.clipIndex;
      prev.clipEnd = next.clipEnd;
      prev.sourceEnd = next.sourceEnd;
      prev.fragmentEnd = next.fragmentEnd;
    } else {
      stitched.push(next);
    }
  }
  return { startSec, durationSec: endSec - startSec, words: stitched.map(({ word }) => word) };
}

export type TimedCaptionClip = TimelineClip & {
  /** words are in the clip's source clock (ms), not the composition clock. */
  words?: TimelineWord[];
  timingStatus?: 'source' | 'estimated' | 'unavailable';
};
const MIN_CAPTION_SEC = 0.8;

/**
 * Time caption lines to the VOICE, not to the whole runtime. A 4:30
 * timeline with a 20-second take spread four lines over 270 seconds, so the
 * words on screen never matched the words being spoken.
 *
 *  - with matching word text: preserve source timings, including pauses;
 *  - edited text: no word timing reuse; the cue span is estimated/unavailable;
 *  - without words: estimated cue distribution only.
 */
export function timeCaptionLines(lines: string[], targetSec: number, voice?: SidecarVoice | null): Array<{ startSec: number; durationSec: number }> {
  const n = lines.length;
  if (n === 0) return [];
  const round = (v: number) => Math.round(v * 1000) / 1000;
  const groups = matchingWordLines(voice?.words || [], lines);
  if (voice && groups?.length) {
    const out: Array<{ startSec: number; durationSec: number }> = [];
    groups.forEach((slice) => {
      const startSec = voice.startSec + slice[0].startMs / 1000;
      const endSec = voice.startSec + slice[slice.length - 1].endMs / 1000;
      out.push({ startSec: round(startSec), durationSec: round(endSec - startSec) });
    });
    return out;
  }
  if (voice && voice.durationSec > 0) {
    const weights = lines.map((l) => Math.max(1, l.trim().length));
    const total = weights.reduce((a, b) => a + b, 0);
    let t = voice.startSec;
    return weights.map((w) => {
      const d = Math.max(MIN_CAPTION_SEC, (voice.durationSec * w) / total);
      const item = { startSec: round(t), durationSec: round(d) };
      t += d;
      return item;
    });
  }
  const slot = targetSec / n;
  return lines.map((_, i) => ({ startSec: round(i * slot), durationSec: round(slot) }));
}

function buildCaptions(lines: string[], targetSec: number, voice?: SidecarVoice | null) {
  const assets: TimelineAsset[] = [];
  const clips: TimelineClip[] = [];
  if (lines.length === 0) return { assets, clips };

  // One clip PER LINE, each carrying its text: the renderer burns
  // `clip.text` between the clip start and end. Timed to the voice (see
  // timeCaptionLines) so the words on screen are the words being spoken.
  assets.push({
    id: assetId('captions', 'all'),
    kind: 'caption',
    source: 'system',
    label: `${lines.length} caption line${lines.length === 1 ? '' : 's'}`,
    tags: [OWNED_TAG, 'captions'],
  });
  const timing = timeCaptionLines(lines, targetSec, voice);
  const matched = matchingWordLines(voice?.words || [], lines);
  lines.forEach((line, i) => {
    const words = matched?.[i].map((w) => ({ ...w,
      startMs: w.startMs + (voice!.startSec - timing[i].startSec) * 1000,
      endMs: w.endMs + (voice!.startSec - timing[i].startSec) * 1000,
    }));
    const clip: TimedCaptionClip = {
      id: clipId('captions', String(i)),
      assetId: assetId('captions', 'all'),
      startSec: timing[i].startSec,
      durationSec: timing[i].durationSec,
      transform: { fit: 'cover' },
      text: line,
      ...(words?.length ? { words, timingStatus: 'source' } : { timingStatus: voice?.words?.length ? 'unavailable' : 'estimated' }),
    };
    clips.push(clip);
  });
  return { assets, clips };
}
export function syncSidecarTracks(
  project: TimelineProject,
  state: SidecarState,
): TimelineProject {
  const targetSec = Math.max(1, project.targetDurationSec);
  const music = buildMusic(state.musicPaths, targetSec);
  const captions = buildCaptions(state.captionLines, targetSec, state.voice);

  const desired: Record<string, { assets: TimelineAsset[]; clips: TimelineClip[] }> = {
    music,
    captions,
  };

  // Idempotence check BEFORE building a new object, so an effect calling this
  // on every render does not loop forever.
  const unchanged = Object.entries(desired).every(([kind, next]) => {
    const current = project.tracks.find((t) => t.kind === kind)?.clips || [];
    const owned = current.filter((c) => c.id.includes(OWNED_TAG));
    // Compare the ASSET each clip points at, not just the clip id. Ids are
    // positional (music-0, music-1), so swapping one bed for another keeps
    // every id and duration identical - comparing those alone returned "no
    // change" and the lane kept showing the OLD filename.
    return (
      owned.length === next.clips.length &&
      owned.every((c, i) => {
        const want = next.clips[i];
        const have = project.assets[c.assetId];
        const wantAsset = [...music.assets, ...captions.assets].find((a) => a.id === want.assetId);
        return (
          c.id === want.id &&
          c.durationSec === want.durationSec &&
          (c.text || '') === (want.text || '') &&
          c.startSec === want.startSec &&
          JSON.stringify((c as TimedCaptionClip).words) === JSON.stringify((want as TimedCaptionClip).words) &&
          (c as TimedCaptionClip).timingStatus === (want as TimedCaptionClip).timingStatus &&
          have?.path === wantAsset?.path &&
          have?.label === wantAsset?.label
        );
      })
    );
  });
  if (unchanged) return project;

  const assets = { ...project.assets };
  // Drop every asset this module previously owned, then re-add the current set.
  // Without this, changing the music bed would leave the old asset behind and
  // the project would grow on every edit.
  for (const id of Object.keys(assets)) {
    if (id.includes(OWNED_TAG)) delete assets[id];
  }
  for (const a of [...music.assets, ...captions.assets]) assets[a.id] = a;

  return {
    ...project,
    assets,
    tracks: project.tracks.map((t) => {
      const next = desired[t.kind];
      if (!next) return t;
      // Preserve anything the operator placed on these lanes by hand.
      const foreign = t.clips.filter((c) => !c.id.includes(OWNED_TAG));
      return { ...t, clips: [...foreign, ...next.clips].sort((a, b) => a.startSec - b.startSec) };
    }),
  };
}
