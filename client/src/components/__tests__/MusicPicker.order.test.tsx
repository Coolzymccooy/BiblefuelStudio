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
    await userEvent.click(screen.getAllByRole('button', { name: /move up/i })[1]);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ paths: ['mylib:b', 'mylib:a'] }));
  });

  it('shows no move buttons unless reorderable', () => {
    render(wrap(<MusicPicker value={{ path: 'a', paths: ['mylib:a', 'mylib:b'], volume: 1 }} onChange={() => {}} busy={false} multiple />));
    expect(screen.queryByRole('button', { name: /move up/i })).not.toBeInTheDocument();
  });
});
