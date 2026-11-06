import { preserveMatchingWords } from './timelineTrackSync';
import type { LyricLine } from './lyricVideoTypes';
import type { StoryProject } from './storyTypes';
import type { SceneScriptProject } from './sceneScriptTypes';

/** Read-only provenance: none of these labels establishes acoustic accuracy. */
export interface TimingQuality {
  status?: string;
  quality?: string;
  provenance?: string;
  accuracy?: string;
  estimated?: boolean;
  verified?: boolean;
  warnings?: (string | { code: string })[];
  counts?: Record<string, number>;
  wordSources?: string[];
  originalEvidence?: TimingQuality;
  tokens?: { index: number; text: string; provenance: string }[];
}

export function timingQualityText(quality?: TimingQuality | null): string {
  if (!quality) return 'Timing quality unknown — no timing evidence saved. Review against the audio.';
  const status = quality.status || quality.quality || quality.provenance;
  const warnings = quality.warnings?.map((w) => typeof w === 'string' ? w : w.code) ?? [];
  const estimated = quality.estimated || quality.accuracy === 'estimated' || status === 'estimated'
    || (quality.counts?.interpolated ?? 0) > 0 || warnings.some((w) => /estimat|interpolat/.test(w));
  const unresolved = status === 'unresolved' || (quality.counts?.unresolved ?? 0) > 0 || warnings.some((w) => /unresolved/.test(w));
  const history = quality.originalEvidence ? ` Original timing: ${timingQualityText(quality.originalEvidence)}` : '';
  if (status === 'manual') return `Manually adjusted — not acoustically verified.${estimated ? ' Includes estimated word timing.' : ''}${unresolved ? ' Includes unresolved words.' : ''}${history}`;
  if (unresolved) return `Unresolved word timing — some words have no reliable placement.${estimated ? ' Includes estimated word timing.' : ''} Review against the audio.`;
  if (estimated) return 'Estimated word timing — approximate placement, not acoustically verified. Review against the audio.';
  if (status === 'asr-matched') return 'ASR-matched timing — recognition matches are not acoustic verification. Review against the audio.';
  if (status === 'native') return 'Native provider timing — not acoustically verified. Review against the audio.';
  if (status === 'measured') return 'Measured timing metadata — acoustic accuracy has not been independently checked here.';
  if (status === 'needs-review' || warnings.length) return 'Timing needs review — matching or placement warnings remain. Not acoustically verified.';
  if (status === 'supplied') return 'Supplied word timing — accuracy unknown, not acoustically verified. Review against the audio.';
  return 'Timing quality unknown — metadata does not establish acoustic accuracy. Review against the audio.';
}

export const storyTimingText = (project: StoryProject): string => timingQualityText(project.transcript?.timing);
export const lyricTimingText = (line: LyricLine): string => timingQualityText(line.timingQuality);
export const lyricTimingMessages = (lines: LyricLine[]): string[] => [...new Set(lines.map(lyricTimingText))];

/** Positive word spans are required for captions; zero-width tokens must not disappear silently. */
export function sceneScriptTimingBlocked(project: SceneScriptProject): boolean {
  return project.captions?.enabled !== false && project.lines.some((line) => line.audio && line.kind !== 'chant' && line.kind !== 'reference' && (
    line.audio.timing?.quality === 'unresolved'
    || !Array.isArray(line.audio.words) || !line.audio.words.length
    || !/[\p{L}\p{N}]/u.test(String(line.text || ''))
    || !preserveMatchingWords(line.audio.words.filter((word) => word && typeof word.text === 'string' && /[\p{L}\p{N}]/u.test(word.text)).map((word) => ({ text: word.text, startMs: word.start, endMs: word.end })),
      [String(line.text || '').split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).join(' ')])
    || line.audio.words.some((word, index) => {
      const nonspoken = word && typeof word.text === 'string' && word.text.trim() && !/[\p{L}\p{N}]/u.test(word.text)
        && line.audio!.timing?.tokens?.some((t) => t.index === index && t.text === word.text && t.provenance === 'nonspoken');
      return !nonspoken && (!word || !Number.isFinite(word.start) || !Number.isFinite(word.end) || word.end <= word.start);
    })
  ));
}
export function sceneScriptTimingMessages(project: SceneScriptProject): string[] {
  return [...new Set(project.lines.filter((line) => line.audio).map((line) => timingQualityText(line.audio!.timing)))];
}
