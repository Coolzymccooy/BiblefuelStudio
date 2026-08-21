import { RotateCcw, History as HistoryIcon, Waves, Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';

/**
 * Transcript toolbar: transcribe, re-transcribe, format, clear, and the saved
 * transcript history dropdown.
 *
 * Extracted from TimelinePage's "Transcribe & Caption" card for the editor
 * shell's Captions tool. Presentational — the page keeps the state.
 *
 * The destructive/edit actions only appear once a transcript EXISTS. Showing
 * "Clear" or "Re-transcribe" with nothing to act on is an invitation to click
 * something that cannot work.
 */

/**
 * Only the fields this toolbar renders. Structural rather than an import of the
 * page's own TranscriptRecord, which also carries words, editedLines and
 * timestamps — none of which a toolbar should need to know about. Callers pass
 * their richer record and it satisfies this shape.
 */
export interface TranscriptSummary {
  id: string;
  label: string;
  sourceFile: string;
  lineCount: number;
}

export interface TranscriptActionsProps<TSummary extends TranscriptSummary = TranscriptSummary> {
  /** True once a working transcript exists; gates the edit actions. */
  hasTranscript: boolean;
  isTranscribing: boolean;
  /** Transcribe needs something to transcribe. */
  canTranscribe: boolean;
  history: TSummary[];
  showHistory: boolean;
  onToggleHistory: () => void;
  onTranscribe: () => void;
  onReTranscribe: () => void;
  onFormatCaptions: () => void;
  onClear: () => void;
  onApplyRecord: (record: TSummary) => void;
  onDeleteRecord: (id: string) => void;
}

export function TranscriptActions<TSummary extends TranscriptSummary>({
  hasTranscript,
  isTranscribing,
  canTranscribe,
  history,
  showHistory,
  onToggleHistory,
  onTranscribe,
  onReTranscribe,
  onFormatCaptions,
  onClear,
  onApplyRecord,
  onDeleteRecord,
}: TranscriptActionsProps<TSummary>) {
  return (
    <div className="relative flex flex-wrap items-center gap-2">
      {hasTranscript && (
        <>
          <Button
            variant="secondary"
            onClick={onFormatCaptions}
            className="h-9 text-xs"
            title="Remove markdown symbols and hashtags from caption lines"
          >
            Format captions
          </Button>
          <Button
            variant="secondary"
            onClick={onClear}
            className="h-9 text-xs"
            title="Clear the working transcript (saved history is kept)"
          >
            Clear
          </Button>
          <Button
            variant="secondary"
            onClick={onReTranscribe}
            disabled={isTranscribing || !canTranscribe}
            className="h-9 text-xs"
            title="Run a fresh Whisper pass (uses render quota)"
          >
            <RotateCcw size={14} className="mr-1.5" />
            Re-transcribe
          </Button>
        </>
      )}

      {history.length > 0 && (
        <Button
          variant="secondary"
          onClick={onToggleHistory}
          className="h-9 text-xs"
          title="Saved transcripts"
          aria-expanded={showHistory}
        >
          <HistoryIcon size={14} className="mr-1.5" />
          History
        </Button>
      )}

      <Button
        onClick={onTranscribe}
        disabled={!canTranscribe || isTranscribing}
        className="h-9 text-xs"
      >
        <Waves size={14} className="mr-2" />
        {isTranscribing ? 'Transcribing...' : 'Transcribe'}
      </Button>

      {showHistory && (
        <div className="absolute right-0 top-full z-30 mt-1 max-h-80 w-80 max-w-[calc(100vw-3rem)] overflow-y-auto rounded-xl border border-white/15 bg-dark-900/98 p-2 shadow-2xl backdrop-blur-xl">
          <p className="text-caption px-2 py-1">Saved transcripts</p>
          {history.map((h) => (
            <div
              key={h.id}
              className="group flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-white/5"
            >
              <button
                type="button"
                onClick={() => onApplyRecord(h)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="truncate text-xs text-content-secondary">{h.label}</p>
                <p className="text-meta">
                  {h.sourceFile} · {h.lineCount} lines
                </p>
              </button>
              <button
                type="button"
                onClick={() => onDeleteRecord(h.id)}
                className="shrink-0 rounded-md p-1.5 text-gray-500 hover:bg-white/5 hover:text-red-400"
                aria-label={`Delete saved transcript ${h.label}`}
                title="Delete"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
