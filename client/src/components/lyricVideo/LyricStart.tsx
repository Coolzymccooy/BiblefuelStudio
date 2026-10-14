import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import { lyricVideoApi } from '../../lib/lyricVideoApi';
import type { LyricProject } from '../../lib/lyricVideoTypes';
import { fieldLabelCls, inputCls, panelCls, primaryBtnCls } from '../story/formStyles';
import { messageOf } from './messageOf';

const MAX_NAME = 100;

/** Where a new song begins: its title and who sings it, and the songs already started. */
export function LyricStart({ onCreated }: { onCreated: (project: LyricProject) => void }) {
  const prefs = useQuery({ queryKey: ['lyric-prefs'], queryFn: () => lyricVideoApi.prefs() });
  const songs = useQuery({ queryKey: ['lyric-projects'], queryFn: () => lyricVideoApi.list() });
  const [title, setTitle] = useState('');
  // Until the artist is typed in, show the one remembered from last time.
  const [typedArtist, setTypedArtist] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const artist = typedArtist ?? prefs.data?.artist ?? '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      onCreated(await lyricVideoApi.create(title.trim(), artist.trim()));
    } catch (err) {
      toast.error(messageOf(err));
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className={`${panelCls} space-y-3`}>
        <div>
          <label htmlFor="lyric-title" className={fieldLabelCls}>Song title</label>
          <input id="lyric-title" className={inputCls} value={title} maxLength={MAX_NAME} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label htmlFor="lyric-artist" className={fieldLabelCls}>Artist</label>
          <input id="lyric-artist" className={inputCls} value={artist} maxLength={MAX_NAME} onChange={(e) => setTypedArtist(e.target.value)} />
        </div>
        <button type="submit" className={primaryBtnCls} disabled={busy || !title.trim()}>
          {busy && <Loader2 size={16} className="animate-spin" aria-hidden />} Start
        </button>
      </form>

      {songs.data && songs.data.length > 0 && (
        <div className="space-y-2">
          <p className={fieldLabelCls}>Your songs</p>
          <ul className="space-y-2">
            {songs.data.map((s) => (
              <li key={s.projectId}>
                <Link to={`/app/lyric-video/${s.projectId}`} className={`${panelCls} flex items-center justify-between gap-3 hover:border-bf-goldDeep`}>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-bf-cream">{s.title}</span>
                    {s.artist && <span className="block truncate text-xs text-content-secondary">{s.artist}</span>}
                  </span>
                  {s.hasRender && <span className="shrink-0 text-xs text-bf-success">Video made</span>}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
