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
      startSec: Math.round(startMs / 10) / 100,
      durationSec: Math.max(0.2, Math.round((endMs - startMs) / 10) / 100),
      words: g,
    };
  });
}
