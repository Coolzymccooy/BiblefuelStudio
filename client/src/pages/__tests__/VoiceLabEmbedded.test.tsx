import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

describe('VoiceLab take timing regression', () => {
  const words = [{ text: 'Hello', startMs: 100, endMs: 500 }];
  async function generate() {
    fireEvent.click(screen.getByRole('button', { name: /^Generate \(/ }));
    await waitFor(() => expect(screen.getByText('Word timing is attached to this audio take.')).toBeInTheDocument());
  }

  it('lands current native timing, then clears it on manual path selection and history reselection', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ ok: true, data: { file: 'take-a.mp3', words } } as any);
    const embedded = setup({ seedText: 'Hello there' });
    await generate();
    fireEvent.click(screen.getByRole('button', { name: /land on vo lane/i }));
    expect(embedded.onLandVoiceover).toHaveBeenLastCalledWith(expect.objectContaining({ path: 'take-a.mp3', words }));
    fireEvent.click(screen.getByRole('tab', { name: /^Takes/ }));
    fireEvent.change(screen.getByPlaceholderText('e.g. server/outputs/audio.mp3'), { target: { value: 'other.wav' } });
    fireEvent.click(screen.getByRole('button', { name: /land on vo lane/i }));
    expect(embedded.onLandVoiceover).toHaveBeenLastCalledWith(expect.objectContaining({ path: 'other.wav', words: undefined }));
    fireEvent.click(screen.getByRole('button', { name: 'tts' }));
    fireEvent.click(screen.getByRole('button', { name: /land on vo lane/i }));
    expect(embedded.onLandVoiceover).toHaveBeenLastCalledWith(expect.objectContaining({ path: 'take-a.mp3', words: undefined }));
  });

  it('does not let an old TTS response overwrite a newly selected take', async () => {
    let resolve!: (value: any) => void;
    vi.spyOn(api, 'post').mockImplementation(() => new Promise((done) => { resolve = done; }));
    const embedded = setup({ seedText: 'Hello there' });
    fireEvent.click(screen.getByRole('button', { name: /^Generate \(/ }));
    fireEvent.click(screen.getByRole('tab', { name: /^Takes/ }));
    fireEvent.change(screen.getByPlaceholderText('e.g. server/outputs/audio.mp3'), { target: { value: 'selected.wav' } });
    await act(async () => resolve({ ok: true, data: { file: 'stale.mp3', words } }));
    fireEvent.click(screen.getByRole('button', { name: /land on vo lane/i }));
    expect(embedded.onLandVoiceover).toHaveBeenLastCalledWith(expect.objectContaining({ path: 'selected.wav', words: undefined }));
  });

  it('clears timing for processed output with silence removal enabled', async () => {
    vi.spyOn(api, 'post')
      .mockResolvedValueOnce({ ok: true, data: { file: 'take-a.mp3', words } } as any)
      .mockResolvedValueOnce({ ok: true, data: { file: 'processed.mp3' } } as any);
    const embedded = setup({ seedText: 'Hello there' });
    await generate();
    fireEvent.click(screen.getByRole('tab', { name: /^Treat/ }));
    const silenceSelect = screen.getAllByRole('combobox').find((select) => select.querySelector('option[value="true"]'))!;
    fireEvent.change(silenceSelect, { target: { value: 'true' } });
    fireEvent.click(screen.getByRole('button', { name: 'Process Audio' }));
    await screen.findByText(/Processed audio has no verified word timing/);
    expect(api.post).toHaveBeenLastCalledWith('/api/audio/process', expect.objectContaining({ inputPath: 'take-a.mp3', silenceRemove: { enabled: true } }), undefined, expect.any(Object));
    fireEvent.click(screen.getByRole('button', { name: /land on vo lane/i }));
    expect(embedded.onLandVoiceover).toHaveBeenLastCalledWith(expect.objectContaining({ path: 'processed.mp3', words: undefined }));
  });

  it('clears timing on upload and on a successful replacement with explicit no timing', async () => {
    vi.spyOn(api, 'post')
      .mockResolvedValueOnce({ ok: true, data: { file: 'take-a.mp3', words } } as any)
      .mockResolvedValueOnce({ ok: true, data: { file: 'take-b.mp3', words: [] } } as any);
    vi.spyOn(api, 'uploadRaw').mockResolvedValue({ ok: true, data: { file: 'uploaded.wav' } } as any);
    const embedded = setup({ seedText: 'Hello there' });
    await generate();
    fireEvent.click(screen.getByRole('button', { name: /^Generate \(/ }));
    await screen.findByText('This take has no word timing. Align it before using word-synced captions.');
    fireEvent.click(screen.getByRole('button', { name: /land on vo lane/i }));
    expect(embedded.onLandVoiceover).toHaveBeenLastCalledWith(expect.objectContaining({ path: 'take-b.mp3', words: undefined }));
    fireEvent.click(screen.getByRole('tab', { name: /^Record/ }));
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File(['synthetic'], 'new.wav', { type: 'audio/wav' })] } });
    await waitFor(() => expect(screen.getByText('uploaded.wav', { selector: 'p.font-mono' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /land on vo lane/i }));
    expect(embedded.onLandVoiceover).toHaveBeenLastCalledWith(expect.objectContaining({ path: 'uploaded.wav', words: undefined }));
  });

  it('clears timing after a failed new generation rather than retaining the prior words', async () => {
    vi.spyOn(api, 'post')
      .mockResolvedValueOnce({ ok: true, data: { file: 'take-a.mp3', words } } as any)
      .mockResolvedValueOnce({ ok: false, error: 'Synthetic failure' } as any);
    const embedded = setup({ seedText: 'Hello there' });
    await generate();
    fireEvent.click(screen.getByRole('button', { name: /^Generate \(/ }));
    await screen.findByText(/Generation failed. No word timing/);
    fireEvent.click(screen.getByRole('button', { name: /land on vo lane/i }));
    expect(embedded.onLandVoiceover).toHaveBeenLastCalledWith(expect.objectContaining({ path: 'take-a.mp3', words: undefined }));
  });
});

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
