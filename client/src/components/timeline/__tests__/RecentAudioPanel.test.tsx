import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecentAudioPanel, MAX_VISIBLE, type AudioHistoryItem } from '../RecentAudioPanel';

const items: AudioHistoryItem[] = [
  { id: '1', path: '/outputs/tts-abi-warm.mp3', kind: 'tts' },
  { id: '2', path: '/outputs/sermon-source.wav', kind: 'source' },
];

function setup(over: Partial<React.ComponentProps<typeof RecentAudioPanel>> = {}) {
  const props = {
    items,
    onAddClip: vi.fn(),
    onUseAsSource: vi.fn(),
    onUseAsMusicBed: vi.fn(),
    ...over,
  };
  render(<RecentAudioPanel {...props} />);
  return props;
}

describe('RecentAudioPanel', () => {
  it('explains the empty state rather than showing a blank box', () => {
    setup({ items: [] });
    expect(screen.getByText(/no audio history yet/i)).toBeInTheDocument();
  });

  it('shows the basename, which is what the user recognises', () => {
    setup();
    expect(screen.getByText('tts-abi-warm.mp3')).toBeInTheDocument();
    expect(screen.getByText('sermon-source.wav')).toBeInTheDocument();
  });

  it('keeps the full path in the title, for when something is wrong', () => {
    setup();
    expect(screen.getByTitle('/outputs/tts-abi-warm.mp3')).toBeInTheDocument();
  });

  it('handles a Windows path', () => {
    setup({ items: [{ id: '1', path: 'C:\\outputs\\clip.mp3', kind: 'tts' }] });
    expect(screen.getByText('clip.mp3')).toBeInTheDocument();
  });

  it('caps a long history — this is quick access, not an archive', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: String(i), path: `/outputs/clip-${i}.mp3`, kind: 'tts',
    }));
    setup({ items: many });
    expect(screen.getByText('clip-0.mp3')).toBeInTheDocument();
    expect(screen.queryByText(`clip-${MAX_VISIBLE}.mp3`)).not.toBeInTheDocument();
  });

  it('passes path AND kind to the add handler', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole('button', { name: /add tts-abi-warm\.mp3 to assembly/i }));
    expect(props.onAddClip).toHaveBeenCalledWith('/outputs/tts-abi-warm.mp3', 'tts');
  });

  it('fires use-as-source and use-as-music-bed with the path', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole('button', { name: /use tts-abi-warm\.mp3 as source/i }));
    expect(props.onUseAsSource).toHaveBeenCalledWith('/outputs/tts-abi-warm.mp3');
    await user.click(screen.getByRole('button', { name: /use sermon-source\.wav as music bed/i }));
    expect(props.onUseAsMusicBed).toHaveBeenCalledWith('/outputs/sermon-source.wav');
  });

  it('names each action by its file, so repeated rows are distinguishable', () => {
    // Every row has the same three icons; without the filename in the label,
    // an assistive-tech user hears "Add to assembly" N times with no way to
    // tell which file each one acts on.
    setup();
    expect(screen.getAllByRole('button', { name: /add .* to assembly/i })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Add sermon-source.wav to assembly' })).toBeInTheDocument();
  });
});
