// Display scheduling only: acoustic word times and animation lead are unchanged.
export type CaptionTiming = { start: number; dur: number; gap: number; kind: string };
export type CaptionWindow = { from: number; fadeInEnd: number; fadeOutStart: number; end: number };

export function captionWindow(line: CaptionTiming, nextStart = Infinity): CaptionWindow {
  const from = line.start - 0.05;
  const spokenEnd = line.start + line.dur;
  // Reference cards retain their existing extended hold, but not over another line.
  const gap = line.kind === 'reference' ? 3.4 : line.gap;
  const hold = Math.min(Math.max(gap - 0.1, 0.25), 0.9);
  const naturalFade = spokenEnd + hold;
  const end = Math.min(naturalFade + 0.3, nextStart - 0.05);
  // Spend available silence on the fade, never fade early across the final word.
  // With no silence there is a hard handoff at the next line's animation lead.
  const fadeOutStart = Math.min(end, end === naturalFade + 0.3 ? naturalFade : Math.max(spokenEnd, end - 0.3));
  return { from, fadeInEnd: from + 0.12, fadeOutStart, end };
}

export function captionOpacity(window: CaptionWindow, t: number): number {
  if (t <= window.from || t >= window.end) return 0;
  const fadeIn = Math.min(1, (t - window.from) / (window.fadeInEnd - window.from));
  const fadeOut = t <= window.fadeOutStart ? 1 : (window.end - t) / (window.end - window.fadeOutStart);
  return Math.min(fadeIn, fadeOut);
}

// Sort without mutating input. Equal starts: the last authored line owns the slot;
// earlier ties get empty windows, rather than painting two conflicting captions.
export function scheduleCaptions<T extends CaptionTiming>(lines: readonly T[]) {
  const ordered = lines.map((line, index) => ({ line, index })).sort((a, b) => a.line.start - b.line.start || a.index - b.index);
  return ordered.map(({ line }, i) => ({ line, window: captionWindow(line, ordered[i + 1]?.line.start) }));
}
