/**
 * Caption omission preflight shared by HTTP and MCP (before its cap charge).
 * Match buildRenderData's legacy default: only explicit enabled:false disables
 * captions. Provenance is not acoustic verification; unknown/native/ASR quality
 * alone must not reject otherwise complete, positive word spans.
 */
export function captionTimingRefusal(project) {
  if (project.captions?.enabled === false) return null;
  const lines = [];
  for (const line of project.lines || []) {
    // Missing voice audio remains the existing NOT_READY/needsVoice check.
    if (!line.audio || line.kind === "chant" || line.kind === "reference") continue;
    const reasons = [];
    if (line.audio.timing?.quality === "unresolved") reasons.push("UNRESOLVED_TIMING");
    const words = line.audio.words;
    if (!Array.isArray(words) || !words.length) reasons.push("MISSING_WORD_TIMING");
    const wordIndexes = Array.isArray(words) ? words.flatMap((word, index) => (
      // Only a matching explicit nonspoken ledger entry can exempt punctuation.
      // Never let a nonspoken label hide a lexical token or unknown word.
      word && typeof word.text === "string" && word.text.trim() && !/[\p{L}\p{N}]/u.test(word.text)
        && line.audio.timing?.tokens?.some((t) => t.index === index && t.text === word.text && t.provenance === "nonspoken")
        ? [] : !word || !Number.isFinite(word.start) || !Number.isFinite(word.end) || word.end <= word.start ? [index] : []
    )) : [];
    if (wordIndexes.length) reasons.push("INVALID_WORD_SPAN");
    // Compare the complete ordered lexical sequence, not just the supplied spans.
    // Explicit nonspoken punctuation can occupy a ledger index, never speech.
    const key = (text) => text.toLowerCase()
      .replace(/^["'“”‘’(\[\{,!?;:]+/u, '')
      .replace(/["'“”‘’)\]\},.!?;:]+$/u, '');
    const authored = String(line.text || "").split(/\s+/).filter((text) => /[\p{L}\p{N}]/u.test(text));
    const supplied = Array.isArray(words) ? words.filter((word) => word && typeof word.text === "string" && /[\p{L}\p{N}]/u.test(word.text)) : [];
    if (!authored.length || authored.length !== supplied.length || authored.some((text, index) => key(text) !== key(supplied[index].text))) reasons.push("WORD_COVERAGE_MISMATCH");
    if (reasons.length) lines.push({ lineId: line.id, reasons, wordIndexes });
  }
  if (!lines.length) return null;
  return {
    code: "CAPTION_TIMING_UNRESOLVED",
    message: "Caption export blocked: unresolved or missing word spans could omit words. Re-record the affected lines, or turn captions off (captions.enabled: false) to render without captions.",
    lines,
  };
}
