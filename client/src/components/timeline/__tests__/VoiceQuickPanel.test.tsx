import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { api } from '../../../lib/api';
import { STORAGE_KEYS } from '../../../lib/storage';
import { VoiceQuickPanel, type VoiceQuickPanelProps } from '../VoiceQuickPanel';

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear(); // Voice Synthesis defaults default to OFF, so the provider tabs drive the request.
  vi.spyOn(api, 'get').mockResolvedValue({ ok: true, data: { ok: true, providers: {
    elevenlabs: { available: true }, azure: { available: true }, fish: { available: false, reason: 'FISH_API_KEY not set' },
    chatterbox: { available: true, reachable: false }, edge: { available: true },
  } } } as any);
});

function setup(over: Partial<VoiceQuickPanelProps> = {}) {
  const props: VoiceQuickPanelProps = {
    onLandVoiceover: vi.fn(),
    onUseAsSource: vi.fn(),
    hasProject: true,
    ...over,
  };
  render(React.createElement(VoiceQuickPanel, props));
  return props;
}

describe('VoiceQuickPanel', () => {
  it('seeds the script from the shared library (one library, many doors)', () => {
    localStorage.setItem(STORAGE_KEYS.scripts, JSON.stringify([{ hook: 'In the chaos, calm awaits you.', verse: 'Jesus is in your boat.', reflection: '', cta: 'Save this.' }]));
    setup();
    expect(screen.getByLabelText('Voice script')).toHaveValue('In the chaos, calm awaits you.\n\nJesus is in your boat.\n\nSave this.');
  });

  it('reflects real provider availability - Fish off with its reason, Chatterbox off when unreachable', async () => {
    setup();
    const fish = await screen.findByRole('button', { name: 'Fish' });
    expect(fish).toBeDisabled();
    expect(fish).toHaveAttribute('title', 'FISH_API_KEY not set');
    expect(screen.getByRole('button', { name: 'Chatterbox' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'ElevenLabs' })).toBeEnabled();
  });

  it('generates via the SAME endpoint the Voice page uses and remembers the take in the shared history', async () => {
    const user = userEvent.setup();
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, data: { file: 'outputs/tts-1.mp3' } } as any);
    setup();
    await user.type(screen.getByLabelText('Voice script'), 'His presence brings peace.');
    await user.click(screen.getByRole('button', { name: /generate voice/i }));
    expect(post).toHaveBeenCalledWith('/api/tts/elevenlabs', expect.objectContaining({
      text: 'His presence brings peace.',
      voiceSettings: { stability: 0.5, similarity_boost: 0.75 },
    }), undefined, expect.anything());
    expect(await screen.findByRole('button', { name: /land on vo lane/i })).toBeInTheDocument();
    const history = JSON.parse(localStorage.getItem(STORAGE_KEYS.audioHistory) || '[]');
    expect(history[0]?.path).toBe('outputs/tts-1.mp3');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.audioPath) || '""')).toBe('outputs/tts-1.mp3');
  });

  it('LANDS the take on the voice-over lane', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'post').mockResolvedValue({ ok: true, data: { file: 'outputs/tts-2.mp3' } } as any);
    const props = setup();
    await user.type(screen.getByLabelText('Voice script'), 'Trust Him.');
    await user.click(screen.getByRole('button', { name: /generate voice/i }));
    await user.click(await screen.findByRole('button', { name: /land on vo lane/i }));
    expect(props.onLandVoiceover).toHaveBeenCalledWith(expect.objectContaining({ path: 'outputs/tts-2.mp3' }));
  });

  it('takes the script handed over from the Script tool, and offers Next after landing', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'post').mockResolvedValue({ ok: true, data: { file: 'outputs/tts-4.mp3' } } as any);
    const onNext = vi.fn();
    setup({ seedText: 'You are more than just your struggles.', onNext });
    expect(screen.getByLabelText('Voice script')).toHaveValue('You are more than just your struggles.');
    await user.click(screen.getByRole('button', { name: /generate voice/i }));
    await user.click(await screen.findByRole('button', { name: /land on vo lane/i }));
    await user.click(screen.getByRole('button', { name: /next: render/i }));
    expect(onNext).toHaveBeenCalled();
  });

  it('refuses to land without a timeline, and says why', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'post').mockResolvedValue({ ok: true, data: { file: 'outputs/tts-3.mp3' } } as any);
    setup({ hasProject: false });
    await user.type(screen.getByLabelText('Voice script'), 'Fear not.');
    await user.click(screen.getByRole('button', { name: /generate voice/i }));
    const land = await screen.findByRole('button', { name: /land on vo lane/i });
    expect(land).toBeDisabled();
    expect(land).toHaveAttribute('title', expect.stringMatching(/create a documentary timeline first/i));
  });
});
