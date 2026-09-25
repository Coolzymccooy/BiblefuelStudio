import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../../lib/api';
import { VoiceLab, type VoiceLabEmbed } from '../VoiceAudioPage';

/**
 * The Voice lab EMBEDDED in the Timeline editor. The point of embedding (not
 * rebuilding) is that every classic block is present; these tests pin the
 * tabs, the handoff from the Script tool, and the landing footer.
 */

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url.startsWith('/api/tts/providers')) {
      return { ok: true, data: { ok: true, providers: {
        elevenlabs: { available: true }, azure: { available: false, reason: 'AZURE_SPEECH_KEY not set' },
        fish: { available: false, reason: 'FISH_API_KEY not set' }, chatterbox: { available: false }, edge: { available: true },
      } } } as any;
    }
    return { ok: true, data: { ok: true, voices: [], items: [], files: [] } } as any;
  });
});

function setup(over: Partial<VoiceLabEmbed> = {}) {
  const embedded: VoiceLabEmbed = {
    hasProject: true,
    onLandVoiceover: vi.fn(),
    onNext: vi.fn(),
    ...over,
  };
  render(
    <MemoryRouter>
      <VoiceLab embedded={embedded} />
    </MemoryRouter>,
  );
  return embedded;
}

describe('VoiceLab (embedded in the Timeline editor)', () => {
  it('docks EVERY classic section as a sub-tab - nothing left behind on the classic page', () => {
    setup();
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent?.trim() || '');
    for (const want of ['Generate', 'Record', 'Treat', 'Music', 'Clone', 'Compare', 'Animation', 'Takes']) {
      expect(tabs.some((t) => t.startsWith(want)), `${want} tab`).toBe(true);
    }
  });

  it('gives the providers muscle: bold name, a note, and the real reason when disabled', async () => {
    setup();
    const group = await screen.findByRole('group', { name: 'Voice provider' });
    const azure = Array.from(group.querySelectorAll('button')).find((b) => /^Azure/.test(b.textContent || ''))!;
    expect(azure).toBeDisabled();
    expect(azure).toHaveAttribute('title', expect.stringMatching(/AZURE_SPEECH_KEY not set/));
    expect(azure.textContent).toMatch(/not configured/);
    const eleven = Array.from(group.querySelectorAll('button')).find((b) => /^ElevenLabs/.test(b.textContent || ''))!;
    expect(eleven).toBeEnabled();
    expect(eleven.textContent).toMatch(/premium/);
  });

  it('takes the script handed over from the Script tool', () => {
    setup({ seedText: 'You are more than just your struggles.' });
    expect(screen.getByLabelText('Voice script')).toHaveValue('You are more than just your struggles.');
  });

  it('cannot land without current audio, and says why', () => {
    setup();
    const land = screen.getByRole('button', { name: /land on vo lane/i });
    expect(land).toBeDisabled();
    expect(land).toHaveAttribute('title', expect.stringMatching(/generate, record or pick a take first/i));
  });

  it('switches sub-tabs in place - Treat shows the audio treatment controls', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('tab', { name: /^Treat/ }));
    expect(screen.getByRole('tab', { name: /^Treat/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByLabelText('Voice script')).not.toBeInTheDocument();
  });
});
