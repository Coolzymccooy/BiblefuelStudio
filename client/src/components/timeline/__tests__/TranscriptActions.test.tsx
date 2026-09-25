import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TranscriptActions, type TranscriptActionsProps } from '../TranscriptActions';

const history = [
  { id: 'h1', label: 'Sunday sermon', sourceFile: 'sermon.mp4', lineCount: 42 },
  { id: 'h2', label: 'Midweek', sourceFile: 'midweek.mp3', lineCount: 18 },
];

function setup(over: Partial<TranscriptActionsProps> = {}) {
  const props: TranscriptActionsProps = {
    hasTranscript: false,
    isTranscribing: false,
    canTranscribe: true,
    history: [],
    showHistory: false,
    onToggleHistory: vi.fn(),
    onTranscribe: vi.fn(),
    onReTranscribe: vi.fn(),
    onFormatCaptions: vi.fn(),
    onClear: vi.fn(),
    onApplyRecord: vi.fn(),
    onDeleteRecord: vi.fn(),
    ...over,
  };
  render(<TranscriptActions {...props} />);
  return props;
}

describe('TranscriptActions', () => {
  describe('which actions are offered', () => {
    it('offers only Transcribe before there is a transcript', () => {
      // Clear/Re-transcribe with nothing to act on invites a click that cannot work.
      setup();
      expect(screen.getByRole('button', { name: /^transcribe$/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /re-transcribe/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /format captions/i })).not.toBeInTheDocument();
    });

    it('offers the edit actions once a transcript exists', () => {
      setup({ hasTranscript: true });
      expect(screen.getByRole('button', { name: /format captions/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /re-transcribe/i })).toBeInTheDocument();
    });

    it('hides History until something is saved', () => {
      setup();
      expect(screen.queryByRole('button', { name: /history/i })).not.toBeInTheDocument();
    });

    it('offers History when records exist', () => {
      setup({ history });
      expect(screen.getByRole('button', { name: /history/i })).toBeInTheDocument();
    });
  });

  describe('disabled states', () => {
    it('cannot transcribe with no source media', () => {
      setup({ canTranscribe: false });
      expect(screen.getByRole('button', { name: /^transcribe$/i })).toBeDisabled();
    });

    it('shows progress and blocks re-entry while transcribing', () => {
      setup({ isTranscribing: true });
      const btn = screen.getByRole('button', { name: /transcribing/i });
      expect(btn).toBeDisabled();
    });

    it('blocks re-transcribe while one is already running', () => {
      setup({ hasTranscript: true, isTranscribing: true });
      expect(screen.getByRole('button', { name: /re-transcribe/i })).toBeDisabled();
    });
  });

  describe('the history dropdown', () => {
    it('stays closed until asked for', () => {
      setup({ history });
      expect(screen.queryByText('Sunday sermon')).not.toBeInTheDocument();
    });

    it('lists saved records with their source and line count', () => {
      setup({ history, showHistory: true });
      expect(screen.getByText('Sunday sermon')).toBeInTheDocument();
      expect(screen.getByText(/sermon\.mp4 · 42 lines/)).toBeInTheDocument();
    });

    it('applies a record when clicked', async () => {
      const user = userEvent.setup();
      const props = setup({ history, showHistory: true });
      await user.click(screen.getByText('Sunday sermon'));
      expect(props.onApplyRecord).toHaveBeenCalledWith(history[0]);
    });

    it('names each delete by its record, so rows are distinguishable', async () => {
      const user = userEvent.setup();
      const props = setup({ history, showHistory: true });
      await user.click(screen.getByRole('button', { name: /delete saved transcript midweek/i }));
      expect(props.onDeleteRecord).toHaveBeenCalledWith('h2');
    });

    it('reports the toggle so the page owns open/closed state', async () => {
      const user = userEvent.setup();
      const props = setup({ history });
      await user.click(screen.getByRole('button', { name: /history/i }));
      expect(props.onToggleHistory).toHaveBeenCalled();
    });
  });

  describe('handlers', () => {
    it('fires transcribe, format and clear', async () => {
      const user = userEvent.setup();
      const props = setup({ hasTranscript: true });
      await user.click(screen.getByRole('button', { name: /^transcribe$/i }));
      expect(props.onTranscribe).toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: /format captions/i }));
      expect(props.onFormatCaptions).toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: /clear/i }));
      expect(props.onClear).toHaveBeenCalled();
    });
  });
});
