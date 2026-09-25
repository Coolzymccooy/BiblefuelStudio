import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MusicPicker } from '../../MusicPicker';
import * as libraryApi from '../../../lib/musicLibraryApi';
import type { MusicTrack } from '../../../lib/musicLibraryApi';

const LIB = [
  { id: 'a', label: 'Peaceful Worship', mood: 'calm', previewUrl: '/music/a.mp3', default: true, source: 'bundled', licence: 'pixabay-cleared', durationSec: 204, ref: 'library:a', credit: 'Music from Pixabay' },
  { id: 'b', label: 'Prayer Piano', mood: 'calm', previewUrl: '/music/b.mp3', default: false, source: 'bundled', licence: 'pixabay-cleared', durationSec: 168, ref: 'library:b', credit: 'Music from Pixabay' },
] as MusicTrack[];

const wrap = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(libraryApi, 'fetchMusicLibrary').mockResolvedValue(LIB);
  vi.spyOn(libraryApi, 'fetchCapabilities').mockResolvedValue({ vocalRemoval: false, amfEncoder: false });
});

describe('music list — keyboard', () => {
  it('the library drawer is modal: focus goes to search, and Escape hands it back to the opener', async () => {
    render(wrap(<MusicPicker multiple value={{ path: null, paths: [], volume: 0.5 }} onChange={() => {}} busy={false} />));
    const opener = await screen.findByRole('button', { name: /add from library/i });
    await userEvent.click(opener);
    const drawer = screen.getByRole('dialog', { name: /music library/i });
    expect(drawer).toHaveAttribute('aria-modal', 'true');
    expect(within(drawer).getByRole('textbox', { name: /search music/i })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: /music library/i })).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('Tab stays inside the drawer', async () => {
    render(wrap(<MusicPicker multiple value={{ path: null, paths: [], volume: 0.5 }} onChange={() => {}} busy={false} />));
    await userEvent.click(await screen.findByRole('button', { name: /add from library/i }));
    const drawer = screen.getByRole('dialog', { name: /music library/i });
    for (let i = 0; i < 20; i += 1) {
      await userEvent.tab();
      expect(drawer.contains(document.activeElement)).toBe(true);
    }
  });

  it('the row menu takes focus, moves with the arrows, and Escape returns to its button', async () => {
    render(wrap(<MusicPicker multiple reorderable value={{ path: 'library:a', paths: ['library:a', 'library:b'], volume: 0.5 }} onChange={() => {}} busy={false} />));
    const trigger = await screen.findByRole('button', { name: /more for prayer piano/i });
    await userEvent.click(trigger);
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem');
    expect(items[0]).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(items[1]).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(items[items.length - 1]).toHaveFocus(); // wraps round
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });
});
