export interface TranscriptWordLike { text: string; start?: number; end?: number; }

export interface TranscriptRecord {
  id: string;
  userId: string;
  sourceFile: string;
  label: string;
  words: TranscriptWordLike[];
  editedLines: string[];
  typographyPreset?: string | null;
  durationSec?: number | null;
  lineCount: number;
  createdAt: string;
  updatedAt: string;
}

export type TranscribeAction =
  | { mode: 'reuse'; record: TranscriptRecord }
  | { mode: 'run' };

/** basename across both posix and windows separators. */
export function baseName(p: string | null | undefined): string {
  return String(p || '').split(/[\\/]/).pop() || '';
}

/**
 * Decide whether clicking Transcribe should REUSE a saved transcript (matched
 * by source-file basename) or RUN a fresh Whisper pass.
 */
export function pickTranscribeAction(
  history: TranscriptRecord[],
  sourceMediaPath: string | null | undefined,
): TranscribeAction {
  const base = baseName(sourceMediaPath);
  if (!base) return { mode: 'run' };
  const record = history.find((h) => baseName(h.sourceFile) === base);
  return record ? { mode: 'reuse', record } : { mode: 'run' };
}
