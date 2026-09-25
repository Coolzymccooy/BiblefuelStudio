import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LibraryDrawer } from '../LibraryDrawer';
import type { MusicTrack } from '../../../lib/musicLibraryApi';

const track = (id: string, label: string, over: Partial<MusicTrack> = {}): MusicTrack => ({
  id, label, mood: 'calm', previewUrl: null, default: false, source: 'bundled', licence: 'pixabay-cleared',
  durationSec: 200, ref: `library:${id}`, credit: 'Music from Pixabay', ...over,
});

const library = [
  track('a', 'Peaceful Worship'),
  track('b', 'Hopeful', { mood: 'uplifting' }),
  track('c', 'First John Two', { source: 'upload', ref: 'mylib:c', credit: '', mood: '', licence: 'unknown' }),
  track('d', 'First John Two (instrumental)', { source: 'upload', ref: 'mylib:d', credit: '', mood: '', derivedFrom: 'mylib:c' }),
];

const open = (onAdd = vi.fn()) => {
  render(
    <LibraryDrawer onClose={vi.fn()} tracks={library} exclude={[]} onAdd={onAdd} playingId={null} canPreview={() => false} onPreview={vi.fn()} />,
  );
  return onAdd;
};
const rows = () => within(screen.getByRole('group', { name: /library tracks/i })).getAllByRole('checkbox');

describe('LibraryDrawer shelves', () => {
  it('has a shelf for the instrumentals Biblefuel made, and one for other uploads', async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole('button', { name: /vocals removed \(1\)/i }));
    expect(rows()).toHaveLength(1);
    expect(screen.getByText('Vocals removed by Biblefuel')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /my uploads \(1\)/i }));
    expect(rows()).toHaveLength(1);
    expect(screen.getByText('First John Two')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^all$/i }));
    expect(rows()).toHaveLength(4);
  });

  it('moods still filter', async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole('button', { name: 'uplifting' }));
    expect(rows()).toHaveLength(1);
  });

  it('select all picks what is on screen, not the whole library', async () => {
    const user = userEvent.setup();
    const onAdd = open();
    await user.click(screen.getByRole('button', { name: /vocals removed \(1\)/i }));
    await user.click(screen.getByRole('button', { name: /select all \(1\)/i }));
    await user.click(screen.getByRole('button', { name: /add 1 track/i }));
    expect(onAdd).toHaveBeenCalledWith(['mylib:d']);
  });

  it('shows no shelf for kinds the library does not have', () => {
    render(<LibraryDrawer onClose={vi.fn()} tracks={library.slice(0, 2)} exclude={[]} onAdd={vi.fn()} playingId={null} canPreview={() => false} onPreview={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /vocals removed/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /my uploads/i })).not.toBeInTheDocument();
  });
});
