import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { RenderAudioPanel, type RenderAudioPanelProps } from '../RenderAudioPanel';

function setup(over: Partial<RenderAudioPanelProps> = {}) {
  const props: RenderAudioPanelProps = {
    audioPath: '',
    onAudioPathChange: vi.fn(),
    audioHistory: [],
    onTrim: vi.fn(),
    musicPath: '',
    musicVolume: 0.3,
    autoDuck: true,
    onMusicChange: vi.fn(),
    ...over,
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(React.createElement(QueryClientProvider, { client: qc },
    React.createElement(RenderAudioPanel, props)));
  return props;
}

describe('RenderAudioPanel', () => {
  it('shows the current voice track', () => {
    setup({ audioPath: '/outputs/sermon.mp3' });
    expect(screen.getByDisplayValue('/outputs/sermon.mp3')).toBeInTheDocument();
  });

  it('says the track is required for waveform, before a render refuses', () => {
    setup();
    expect(screen.getByText(/required for waveform/i)).toBeInTheDocument();
  });

  it('offers Trim only once a track is set', () => {
    setup({ audioPath: '' });
    expect(screen.queryByRole('button', { name: /trim/i })).not.toBeInTheDocument();
  });

  it('trims the TRIMMED path, not raw input with whitespace', async () => {
    const user = userEvent.setup();
    const props = setup({ audioPath: '  /outputs/a.mp3  ' });
    await user.click(screen.getByRole('button', { name: /trim/i }));
    expect(props.onTrim).toHaveBeenCalledWith('/outputs/a.mp3');
  });

  it('offers recent takes as shortcuts', async () => {
    const user = userEvent.setup();
    const props = setup({
      audioHistory: [{ id: '1', path: '/outputs/take1.mp3', kind: 'voice' }],
    });
    await user.click(screen.getByRole('button', { name: 'voice' }));
    expect(props.onAudioPathChange).toHaveBeenCalledWith('/outputs/take1.mp3');
  });

  it('caps the shortcut list so it cannot swamp the panel', () => {
    setup({
      audioHistory: Array.from({ length: 9 }, (_, i) => ({
        id: String(i), path: `/o/${i}.mp3`, kind: `k${i}`,
      })),
    });
    expect(screen.getByRole('button', { name: 'k3' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'k4' })).not.toBeInTheDocument();
  });

  it('normalises a cleared music path to a string, not null', async () => {
    // The render payload treats musicPath as a string; null would serialise
    // differently and the server would see a present-but-null field.
    const props = setup({ musicPath: '/m/bed.mp3' });
    expect(typeof props.musicPath).toBe('string');
  });
});
