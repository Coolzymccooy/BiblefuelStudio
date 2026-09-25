import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CreateVoiceHero } from './CreateVoiceHero';

const base = {
  ttsText: 'hello',
  onTtsTextChange: vi.fn(),
  onUseLatestScript: vi.fn(),
  onFormatForVoice: vi.fn(),
  onInsertTemplate: vi.fn(),
  providerControls: <div>PROVIDER_CONTROLS</div>,
  recordUploadPanel: <div>RECORD_PANEL</div>,
};

describe('CreateVoiceHero', () => {
  it('shows the text, helpers and provider controls; hides record/upload until expanded', async () => {
    const user = userEvent.setup();
    render(<CreateVoiceHero {...base} />);
    expect(screen.getByDisplayValue('hello')).toBeInTheDocument();
    expect(screen.getByText('PROVIDER_CONTROLS')).toBeInTheDocument();
    expect(screen.queryByText('RECORD_PANEL')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /record .*upload/i }));
    expect(screen.getByText('RECORD_PANEL')).toBeInTheDocument();
  });

  it('fires the text helpers', async () => {
    const user = userEvent.setup();
    render(<CreateVoiceHero {...base} />);
    await user.click(screen.getByRole('button', { name: /use latest script/i }));
    expect(base.onUseLatestScript).toHaveBeenCalled();
  });
});
