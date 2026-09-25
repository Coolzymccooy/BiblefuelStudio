import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tracklist } from '../Tracklist';
import { LibraryDrawer } from '../LibraryDrawer';
import type { TrackRowData } from '../TrackRow';
import type { MusicTrack } from '../../../lib/musicLibraryApi';

const rowsOf = (n: number): TrackRowData[] => Array.from({ length: n }, (_, i) => ({
  key: `k${i}`, ref: `library:t${i}`, label: `Track ${i + 1}`, credit: '', licence: 'cleared', durationSec: 180, colour: '#6b5324', canPlay: false,
} as unknown as TrackRowData));

const list = (n: number, menuFor = vi.fn(() => [])) => render(
  <Tracklist rows={rowsOf(n)} variant="full" reorderable onReorder={vi.fn()} playingKey={null} onPreview={vi.fn()} onLicenceClick={vi.fn()} menuFor={menuFor} />,
);
const shownTitles = () => within(screen.getByRole('list', { name: /chosen tracks/i })).getAllByRole('listitem').map((li) => li.textContent || '');

beforeEach(() => localStorage.clear());

describe('Tracklist pages', () => {
  it('shows 10 a page by default, with Next to the rest', async () => {
    const user = userEvent.setup();
    list(23);
    expect(shownTitles()).toHaveLength(10);
    expect(screen.getByText('Showing 1–10 of 23')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /previous page/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /next page/i }));
    expect(screen.getByText('Showing 11–20 of 23')).toBeInTheDocument();
    expect(shownTitles()[0]).toContain('Track 11');
    await user.click(screen.getByRole('button', { name: /next page/i }));
    expect(shownTitles()).toHaveLength(3);
    expect(screen.getByRole('button', { name: /next page/i })).toBeDisabled();
  });

  it('rows keep their place in the whole list (numbers and actions)', async () => {
    const user = userEvent.setup();
    const menuFor = vi.fn(() => []);
    list(15, menuFor);
    await user.click(screen.getByRole('button', { name: /next page/i }));
    expect(menuFor).toHaveBeenCalledWith(10);
    expect(menuFor).not.toHaveBeenCalledWith(0 + 20);
  });

  it('can show up to 100 a page, and remembers the choice', async () => {
    const user = userEvent.setup();
    const { unmount } = list(120);
    await user.selectOptions(screen.getByRole('combobox', { name: /tracks per page/i }), '100');
    expect(shownTitles()).toHaveLength(100);
    unmount();
    list(120);
    expect(shownTitles()).toHaveLength(100);
  });

  it('the pager is there even when everything fits on one page', () => {
    list(4);
    expect(screen.getByRole('button', { name: /next page/i })).toBeDisabled();
    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument();
  });
});

describe('Library drawer pages', () => {
  const library: MusicTrack[] = Array.from({ length: 24 }, (_, i) => ({
    id: `t${i}`, label: `Song ${i + 1}`, mood: i < 3 ? 'uplifting' : 'calm', previewUrl: null, default: false,
    source: 'bundled', licence: 'pixabay-cleared', durationSec: 200, ref: `library:t${i}`, credit: 'Music from Pixabay',
  }));
  const open = () => render(<LibraryDrawer onClose={vi.fn()} tracks={library} exclude={[]} onAdd={vi.fn()} playingId={null} canPreview={() => false} onPreview={vi.fn()} />);
  const rows = () => within(screen.getByRole('group', { name: /library tracks/i })).getAllByRole('checkbox');

  it('pages the library, and a new filter starts at its first page', async () => {
    const user = userEvent.setup();
    open();
    expect(rows()).toHaveLength(10);
    await user.click(screen.getByRole('button', { name: /next page/i }));
    await user.click(screen.getByRole('button', { name: /next page/i }));
    expect(rows()).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: 'uplifting' }));
    expect(screen.getByText('Showing 1–3 of 3')).toBeInTheDocument();
  });
});
