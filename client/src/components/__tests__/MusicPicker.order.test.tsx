import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MusicPicker } from '../MusicPicker';
import * as libraryApi from '../../lib/musicLibraryApi';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(libraryApi, 'fetchMusicLibrary').mockResolvedValue([]);
  vi.spyOn(libraryApi, 'fetchCapabilities').mockResolvedValue({ vocalRemoval: false, amfEncoder: false });
});

const wrap = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
);

describe('MusicPicker — reorder', () => {
  it('moves a chosen track up', async () => {
    const onChange = vi.fn();
    render(wrap(<MusicPicker value={{ path: 'a', paths: ['mylib:a', 'mylib:b'], volume: 1 }} onChange={onChange} busy={false} multiple reorderable />));
    await userEvent.click(screen.getByRole('button', { name: /more for b$/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /move up/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ paths: ['mylib:b', 'mylib:a'] }));
  });

  it('a fixed order can be dragged: each row has a grip', () => {
    render(wrap(<MusicPicker value={{ path: 'a', paths: ['mylib:a', 'mylib:b'], volume: 1 }} onChange={() => {}} busy={false} multiple reorderable />));
    expect(screen.getAllByRole('button', { name: /^drag /i })).toHaveLength(2);
  });

  it('shuffle offers no grip and no move', async () => {
    render(wrap(<MusicPicker value={{ path: 'a', paths: ['mylib:a', 'mylib:b'], volume: 1 }} onChange={() => {}} busy={false} multiple />));
    expect(screen.queryByRole('button', { name: /^drag /i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /more for a$/i }));
    expect(screen.queryByRole('menuitem', { name: /move up/i })).not.toBeInTheDocument();
  });
});
