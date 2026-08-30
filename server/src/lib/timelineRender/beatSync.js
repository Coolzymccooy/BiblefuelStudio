export function planBeatSyncedHighlights(windows, options = {}) {
  const count = Math.max(1, Number(options.count || 6));
  const minSpacingSec = Math.max(0, Number(options.minSpacingSec || 6));
  const candidates = (windows || [])
    .map((w) => ({
      startSec: Number(w.startSec),
      durationSec: Number(w.durationSec || options.defaultDurationSec || 4),
      energy: Number(w.energy || 0),
    }))
    .filter((w) => Number.isFinite(w.startSec) && Number.isFinite(w.durationSec) && w.durationSec > 0)
    .sort((a, b) => b.energy - a.energy || a.startSec - b.startSec);

  const selected = [];
  for (const candidate of candidates) {
    if (selected.some((s) => Math.abs(s.startSec - candidate.startSec) < minSpacingSec)) continue;
    selected.push({
      ...candidate,
      label: `high-energy worship moment @ ${Math.round(candidate.startSec)}s`,
      score: Math.round(candidate.energy * 100),
    });
    if (selected.length >= count) break;
  }

  return selected.sort((a, b) => a.startSec - b.startSec);
}
