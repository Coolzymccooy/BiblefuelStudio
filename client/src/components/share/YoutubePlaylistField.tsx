import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { fieldLabelCls, inputCls } from '../story/formStyles';

/** Where a published video goes: nowhere, an existing playlist, or a new one by name. */
export type PlaylistChoice =
  | { kind: 'none' }
  | { kind: 'existing'; id: string }
  | { kind: 'new'; title: string };

export const NO_PLAYLIST: PlaylistChoice = { kind: 'none' };

interface Playlist { id: string; title: string; itemCount: number }

const NEW = '__new__';

/** The publish body's playlist fields for a choice; nothing when there is none. */
export function playlistFields(choice: PlaylistChoice): { playlistId?: string; newPlaylistTitle?: string } {
  if (choice.kind === 'existing') return { playlistId: choice.id };
  if (choice.kind === 'new' && choice.title.trim()) return { newPlaylistTitle: choice.title.trim() };
  return {};
}

export function YoutubePlaylistField({ value, onChange }: { value: PlaylistChoice; onChange: (c: PlaylistChoice) => void }) {
  const [connected, setConnected] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);

  useEffect(() => {
    let live = true;
    (async () => {
      const status = await api.get<{ connected: boolean; canUsePlaylists?: boolean }>('/api/social/youtube/status');
      if (!live || !status.ok || !status.data?.connected) return;
      setConnected(true);
      setAllowed(Boolean(status.data.canUsePlaylists));
      const list = await api.get<{ playlists: Playlist[] }>('/api/social/youtube/playlists');
      if (live && list.ok) setPlaylists(list.data?.playlists ?? []);
    })();
    return () => { live = false; };
  }, []);

  // Without a connected channel there is nothing to choose from.
  if (!connected) return null;

  const selected = value.kind === 'existing' ? value.id : value.kind === 'new' ? NEW : '';
  const pick = (v: string) => {
    if (v === NEW) onChange({ kind: 'new', title: '' });
    else if (v) onChange({ kind: 'existing', id: v });
    else onChange(NO_PLAYLIST);
  };

  return (
    <div className="space-y-2">
      <label className={fieldLabelCls}>
        Playlist
        <select value={selected} onChange={(e) => pick(e.target.value)} disabled={!allowed} className={inputCls}>
          <option value="">No playlist</option>
          {playlists.map((p) => (
            <option key={p.id} value={p.id}>{p.title} ({p.itemCount} {p.itemCount === 1 ? 'video' : 'videos'})</option>
          ))}
          <option value={NEW}>New playlist…</option>
        </select>
      </label>
      {!allowed && (
        <p className="text-help">
          To add videos to playlists, reconnect YouTube once in <a href="/app/settings" className="underline">Settings</a>.
        </p>
      )}
      {allowed && value.kind === 'new' && (
        <label className={fieldLabelCls}>
          New playlist name
          <input
            value={value.title}
            onChange={(e) => onChange({ kind: 'new', title: e.target.value })}
            maxLength={150}
            placeholder="I Still Dey: Afro-gospel anthems"
            className={inputCls}
          />
          <span className="field-help block font-normal">Made public. If your channel already has a playlist with this name, the video goes there.</span>
        </label>
      )}
    </div>
  );
}
