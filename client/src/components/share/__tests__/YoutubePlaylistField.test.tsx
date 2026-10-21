import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { api } from '../../../lib/api';
import { YoutubePlaylistField, NO_PLAYLIST, playlistFields, type PlaylistChoice } from '../YoutubePlaylistField';

function stubServer({ connected = true, canUsePlaylists = true } = {}) {
  return vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url.endsWith('/youtube/status')) return { ok: true, data: { connected, canUsePlaylists } } as any;
    if (url.endsWith('/youtube/playlists')) return { ok: true, data: { playlists: [{ id: 'PLa', title: 'Oba Gba', itemCount: 1 }, { id: 'PLb', title: 'I Still Dey', itemCount: 4 }] } } as any;
    return { ok: false, error: 'unexpected' } as any;
  });
}

function Harness({ onChange }: { onChange?: (c: PlaylistChoice) => void }) {
  const [value, setValue] = useState<PlaylistChoice>(NO_PLAYLIST);
  return <YoutubePlaylistField value={value} onChange={(c) => { setValue(c); onChange?.(c); }} />;
}

beforeEach(() => vi.restoreAllMocks());

describe('YoutubePlaylistField', () => {
  it("lists the channel's playlists and picks one", async () => {
    stubServer();
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);
    expect(await screen.findByRole('option', { name: 'I Still Dey (4 videos)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Oba Gba (1 video)' })).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: /playlist/i }), 'PLb');
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'existing', id: 'PLb' });
  });

  it('names a new playlist', async () => {
    stubServer();
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);
    await screen.findByRole('option', { name: /oba gba/i });
    await user.selectOptions(screen.getByRole('combobox', { name: /playlist/i }), 'New playlist…');
    await user.type(screen.getByLabelText(/new playlist name/i), 'Soundtrack');
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'new', title: 'Soundtrack' });
  });

  it('asks for a reconnect when the connection may not add to playlists', async () => {
    stubServer({ canUsePlaylists: false });
    render(<Harness />);
    expect(await screen.findByText(/reconnect youtube once/i)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /playlist/i })).toBeDisabled();
  });

  it('shows nothing when YouTube is not connected', async () => {
    const get = stubServer({ connected: false });
    const { container } = render(<Harness />);
    await vi.waitFor(() => expect(get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

describe('playlistFields', () => {
  it('turns a choice into the publish fields', () => {
    expect(playlistFields(NO_PLAYLIST)).toEqual({});
    expect(playlistFields({ kind: 'existing', id: 'PLa' })).toEqual({ playlistId: 'PLa' });
    expect(playlistFields({ kind: 'new', title: '  Oba Gba ' })).toEqual({ newPlaylistTitle: 'Oba Gba' });
    expect(playlistFields({ kind: 'new', title: '   ' })).toEqual({});
  });
});
