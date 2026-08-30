/**
 * Can this render run, and if not, why?
 *
 * These four rules already existed in RenderPage, but as sequential early
 * returns inside the submit handler: each one fired a toast AFTER the operator
 * pressed Render, and returned, so fixing the first only revealed the second.
 * Pulled out here they can be evaluated continuously and shown ON the controls
 * that are missing something - the state is knowable before the click, so it
 * should be visible before the click.
 *
 * Pure: takes a snapshot, returns a verdict. No toasts, no state.
 */

export type RenderMode = 'video' | 'waveform';

export interface RenderInputs {
  mode: RenderMode;
  /** Raw textarea contents; blank lines are ignored. */
  lines: string;
  audioPath: string;
  backgroundPath: string;
  /** How many backgrounds are selected in the picker. */
  backgroundItemCount: number;
  autoBackground: boolean;
}

export interface ReadinessNote {
  /** Which control to attach this to. */
  field: 'background' | 'lines' | 'audioPath';
  message: string;
}

export interface Readiness {
  ready: boolean;
  blockers: ReadinessNote[];
  warnings: ReadinessNote[];
  lineCount: number;
  maxLines: number;
}

/** The renderer slices to this many caption lines. */
const MAX_LINES = 6;

export function checkRenderReadiness(input: RenderInputs): Readiness {
  const blockers: ReadinessNote[] = [];
  const warnings: ReadinessNote[] = [];

  const cleanLines = input.lines.split('\n').map((l) => l.trim()).filter(Boolean);
  const hasBackground = Boolean(input.backgroundPath) || input.backgroundItemCount > 0;

  // Auto only covers VIDEO mode; waveform still needs a real background.
  const autoCovers = input.autoBackground && input.mode === 'video';

  if (!hasBackground && !autoCovers) {
    blockers.push({
      field: 'background',
      message: input.mode === 'video'
        ? 'Pick a background, or turn on Auto to let BibleFuel choose one.'
        : 'Waveform mode needs a background image. Pick one.',
    });
  }

  if (cleanLines.length === 0) {
    blockers.push({
      field: 'lines',
      message: 'Add at least one caption line — this is the text on screen.',
    });
  } else if (cleanLines.length > MAX_LINES) {
    // A warning, not a blocker: the renderer slices rather than refusing.
    warnings.push({
      field: 'lines',
      message: `${cleanLines.length} lines — only the first ${MAX_LINES} will be used.`,
    });
  }

  if (input.mode === 'waveform') {
    if (!input.audioPath.trim()) {
      blockers.push({
        field: 'audioPath',
        message: 'Waveform mode renders an audio file. Make or pick a voice track first.',
      });
    }
    if (input.backgroundItemCount > 1) {
      blockers.push({
        field: 'background',
        message: 'Waveform uses a single background. Remove the extras, or switch to Video.',
      });
    }
  }

  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
    lineCount: cleanLines.length,
    maxLines: MAX_LINES,
  };
}
