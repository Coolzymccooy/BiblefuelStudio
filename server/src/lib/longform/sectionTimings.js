/**
 * Long-form sections carry measured start/end from narration. Story's scene
 * segmenter still works on words, so spread each section's words evenly
 * inside its own window — far closer to reality than spreading the whole
 * script across the whole file, and it lands scene cuts on section edges.
 */
export function wordsFromSections(sections) {
  const out = [];
  for (const s of Array.isArray(sections) ? sections : []) {
    const tokens = String(s?.text || "").split(/\s+/).filter(Boolean);
    const start = Number(s?.startMs) || 0;
    const end = Math.max(start, Number(s?.endMs) || start);
    if (!tokens.length || end <= start) continue;
    const step = (end - start) / tokens.length;
    tokens.forEach((text, i) => {
      out.push({ text, startMs: Math.round(start + i * step), endMs: Math.round(start + (i + 1) * step) });
    });
  }
  return out;
}

export function chaptersFromSections(sections) {
  return (Array.isArray(sections) ? sections : [])
    .filter((s) => s && String(s.heading || "").trim())
    .map((s) => ({ startMs: Number(s.startMs) || 0, title: String(s.heading).trim() }));
}
