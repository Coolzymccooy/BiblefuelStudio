import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MusicTrack } from '../../../lib/musicLibraryApi';

const track = (id: string, label: string, over: Partial<MusicTrack> = {}): MusicTrack => ({
  id, label, mood: 'calm', previewUrl: `/music/${id}.mp3`, default: false, source: 'bundled', licence: 'pixabay-cleared',
  durationSec: 229, ref: `library:${id}`, credit: 'Music from Pixabay', ...over,
});
const tracks = [track('a', 'Peaceful Worship', { default: true }), track('b', 'Prayer Piano'), track('c', 'Hopeful')];

vi.mock('../useLibraryActions', () => ({
  useLibraryActions: () => ({
    tracks,
    isUploading: false,
    instrumentalFor: null,
    setInstrumentalFor: vi.fn(),
    refresh: vi.fn(),
    uploadFile: vi.fn(),
    trackForRef: (p: string) => tracks.find((t) => t.ref === p),
    trackLabel: (p: string) => tracks.find((t) => t.ref === p)?.label ?? p.split('/').pop(),
    manageControls: () => null,
  }),
}));

import { SongCard } from '../SongCard';

beforeEach(() => localStorage.clear());

describe('SongCard', () => {
  it('shows the chosen song with its credit and length', () => {
    render(<SongCard value={{ path: 'library:b', volume: 0.3, autoDuck: true }} onChange={vi.fn()} busy={false} />);
    expect(screen.getByText('Prayer Piano')).toBeInTheDocument();
    expect(screen.getByText('Music from Pixabay')).toBeInTheDocument();
    expect(screen.getByText('3:49')).toBeInTheDocument();
  });

  it('changes the song from the library drawer, one song at a time', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SongCard value={{ path: 'library:b', volume: 0.5, autoDuck: false }} onChange={onChange} busy={false} />);
    await user.click(screen.getByRole('button', { name: /change song/i }));
    const drawer = screen.getByRole('dialog', { name: /music library/i });
    expect(within(drawer).getByText('Choose a song')).toBeInTheDocument();
    expect(within(drawer).queryByText('Prayer Piano')).not.toBeInTheDocument();
    await user.click(within(drawer).getByRole('radio', { name: /hopeful/i }));
    await user.click(within(drawer).getByRole('radio', { name: /peaceful worship/i }));
    await user.click(within(drawer).getByRole('button', { name: /use this song/i }));
    expect(onChange).toHaveBeenCalledWith({ path: 'library:a', volume: 0.5, autoDuck: false });
  });

  it('with no song: says so, and offers the default', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SongCard value={{ path: null, volume: 0.3 }} onChange={onChange} busy={false} />);
    expect(screen.getByText(/no music yet/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /use the default \(peaceful worship\)/i }));
    expect(onChange).toHaveBeenCalledWith({ path: 'library:a', volume: 0.3, autoDuck: true });
  });

  it('removes the song, and adjusts volume and autoduck', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SongCard value={{ path: 'library:b', volume: 0.3, autoDuck: true }} onChange={onChange} busy={false} />);
    await user.click(screen.getByRole('checkbox', { name: 'autoduck' }));
    expect(onChange).toHaveBeenLastCalledWith({ path: 'library:b', volume: 0.3, autoDuck: false });
    await user.click(screen.getByRole('button', { name: /remove music/i }));
    expect(onChange).toHaveBeenLastCalledWith({ path: null, volume: 0.3, autoDuck: true });
  });
});
