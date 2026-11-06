/** The same 1x transform is used for VO atrim/asetpts/adelay and captions. */
export function clipClock(clip) {
  const finite = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback;
  return {
    sourceStart: Math.max(0, finite(clip.sourceStartSec, 0)),
    start: Math.max(0, finite(clip.startSec, 0)),
    duration: Math.max(0.001, finite(clip.durationSec, 2)),
  };
}

/** Map display punctuation onto existing acoustic units, never onto new spans.
 * A conservative allowlist excludes currency/math symbols and numeric signs
 * attached to numbers. Each timed unit must contain exactly one lexical token.
 * Keep this contract identical to client timelineTrackSync.ts.
 */
export function matchCaptionDisplayWords(source, text) {
  const tokens = String(text || '').trim().split(/\s+/).filter(Boolean);
  const nonspoken = (token) => /^["'“”‘’()[\]{},.!?;:\-‐‑‒–—―…]+$/u.test(token);
  const key = (token) => token.toLowerCase()
    .replace(/^["'“”‘’(\[\{,!?;:]+/u, '')
    .replace(/["'“”‘’)\]\},.!?;:]+$/u, '');
  const lexical = tokens.map((token, index) => ({ token, index })).filter(({ token }) => !nonspoken(token));
  if (!source.length || lexical.length !== source.length) return null;
  const mapped = source.map((w, i) => {
    const parts = String(w.text || '').trim().split(/\s+/).filter(Boolean).filter((token) => !nonspoken(token));
    if (parts.length !== 1 || !key(parts[0]) || key(parts[0]) !== key(lexical[i].token) ||
        !Number.isFinite(w.startMs) || !Number.isFinite(w.endMs) || w.endMs <= w.startMs) return null;
    // Leading punctuation belongs to the first word; inter-word punctuation
    // stays with the preceding word. No punctuation-only acoustic event.
    const start = i === 0 ? 0 : lexical[i].index;
    const end = i + 1 < lexical.length ? lexical[i + 1].index : tokens.length;
    return { ...w, text: tokens.slice(start, end).join(' ') };
  });
  return mapped.some((w) => !w) ? null : mapped;
}

/** Caption words are source-clock ms. Reject stale edited text before trimming. */
export function captionRendererInput(clip) {
  const clock = clipClock(clip);
  const source = Array.isArray(clip.words) ? clip.words : [];
  const matched = matchCaptionDisplayWords(source, clip.text);
  if (!matched || ['estimated', 'unavailable'].includes(clip.timingStatus)) {
    return { timingStatus: source.length || clip.timingStatus === 'unavailable' ? 'unavailable' : 'estimated', words: [] };
  }
  // Apply authored tokens BEFORE trimming so indexes still refer to the
  // complete source word list, even when the clip starts halfway through it.
  const words = matched
    .filter((w) => w.endMs / 1000 > clock.sourceStart && w.startMs / 1000 < clock.sourceStart + clock.duration)
    .map((w) => ({ text: w.text,
      start: clock.start + Math.max(clock.sourceStart, w.startMs / 1000) - clock.sourceStart,
      end: clock.start + Math.min(clock.sourceStart + clock.duration, w.endMs / 1000) - clock.sourceStart,
    }));
  return { timingStatus: words.length ? 'source' : 'unavailable', words };
}

export function buildCaptionClipsFromWords(words, options = {}) {
  const maxWordsPerClip = Math.max(1, Number(options.maxWordsPerClip || 5));
  const maxGapMs = Math.max(0, Number(options.maxGapMs || 650));
  const clean = (words || [])
    .map((w) => ({ text: String(w.text || '').trim(), startMs: Number(w.startMs), endMs: Number(w.endMs) }))
    .filter((w) => w.text && Number.isFinite(w.startMs) && Number.isFinite(w.endMs) && w.endMs > w.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  const groups = [];
  let group = [];
  for (const word of clean) {
    const prev = group[group.length - 1];
    const gap = prev ? word.startMs - prev.endMs : 0;
    if (group.length && (group.length >= maxWordsPerClip || gap > maxGapMs)) {
      groups.push(group);
      group = [];
    }
    group.push(word);
  }
  if (group.length) groups.push(group);

  return groups.map((g, index) => {
    const startMs = g[0].startMs;
    const endMs = g[g.length - 1].endMs;
    return {
      id: `caption-${index + 1}`,
      kind: 'caption',
      text: g.map((w) => w.text).join(' '),
      startSec: startMs / 1000,
      durationSec: Math.max(0.2, (endMs - startMs) / 1000),
      words: g.map((w) => ({ ...w, startMs: w.startMs - startMs, endMs: w.endMs - startMs })),
      timingStatus: 'source',
    };
  });
}
