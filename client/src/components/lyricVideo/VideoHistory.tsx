import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { lyricVideoApi } from '../../lib/lyricVideoApi';
import { lyricDownloadUrl, lyricVideoUrl } from '../../lib/lyricDownload';
import { aspectName } from '../../lib/lyricRenderOptions';
import { formatSongLength } from '../../lib/lyricTiming';
import type { LyricHistoryItem } from '../../lib/lyricVideoTypes';
import { fieldLabelCls, panelCls, secondaryBtnCls } from '../story/formStyles';

/** How often the list is asked for again while a video is being made. */
export const POLL_MS = 5000;
/** Rows shown at first, and added by each press of Show more. */
export const PAGE_SIZE = 20;

const isRunning = (item: LyricHistoryItem) => item.status === 'running';

/** Running videos first; the rest keep the order the server gave (newest first). */
const runningFirst = (items: LyricHistoryItem[]) => [...items.filter(isRunning), ...items.filter((i) => !isRunning(i))];

/** "Portrait · 720p · 3:02 · 15/10/2026"; a part that is not known is left out. */
function detailsOf(item: LyricHistoryItem): string {
  const when = new Date(item.at);
  return [
    aspectName(item.aspect),
    item.quality,
    item.durationSec === undefined ? '' : formatSongLength(item.durationSec),
    Number.isNaN(when.getTime()) ? '' : when.toLocaleDateString('en-GB'),
  ].filter(Boolean).join(' · ');
}

function HistoryRow({ item, watching, onWatch }: { item: LyricHistoryItem; watching: boolean; onWatch: () => void }) {
  const openSong = (
    <Link to={`/app/lyric-video/${item.projectId}`} className={secondaryBtnCls} aria-label={`Open song ${item.title}`}>Open song</Link>
  );
  return (
    <li className={`${panelCls} space-y-2`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-bf-cream">{item.title}</span>
          {item.artist && <span className="block truncate text-xs text-content-secondary">{item.artist}</span>}
          <span className="block text-sm text-content-secondary">{detailsOf(item)}</span>
          {item.status === 'running' && <span className="block text-sm text-bf-cream">Rendering… {Math.round(item.progress ?? 0)}%</span>}
          {item.status === 'failed' && <span className="block text-sm text-bf-danger">Failed: {item.error}</span>}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {item.status === 'done' && item.file && (
            <>
              <button type="button" className={secondaryBtnCls} aria-label={`Watch ${item.title}`} aria-expanded={watching} onClick={onWatch}>Watch</button>
              <a href={lyricDownloadUrl(item.file, item.title)} className={secondaryBtnCls} aria-label={`Download ${item.title}`}>
                <Download size={16} aria-hidden /> Download
              </a>
            </>
          )}
          {openSong}
        </span>
      </div>
      {watching && item.file && (
        <video src={lyricVideoUrl(item.file)} controls playsInline autoPlay className="max-h-96 w-full rounded-xl bg-black" aria-label={`${item.title} video`} />
      )}
    </li>
  );
}

/** Every video made from any song: finished, being made, or failed. Quiet when it cannot be loaded, so the start screen never breaks. */
export function VideoHistory() {
  const history = useQuery({
    queryKey: ['lyric-renders'],
    queryFn: () => lyricVideoApi.renders(),
    // Asks again only while a video is on the go.
    refetchInterval: (query) => (query.state.data?.some(isRunning) ? POLL_MS : false),
  });
  const [watching, setWatching] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE_SIZE);

  if (history.isError) {
    return (
      <div className="space-y-2">
        <h2 className={fieldLabelCls}>Your videos</h2>
        <p className="text-sm text-content-secondary">Your videos could not be loaded.</p>
      </div>
    );
  }
  if (!history.data) return null;

  const items = runningFirst(history.data);
  return (
    <div className="space-y-2">
      <h2 className={fieldLabelCls}>Your videos</h2>
      {items.length === 0 ? (
        <p className="text-sm text-content-secondary">Videos you make will be listed here.</p>
      ) : (
        <>
          <ul className="space-y-2">
            {items.slice(0, shown).map((item) => (
              <HistoryRow
                key={item.jobId}
                item={item}
                watching={watching === item.jobId}
                onWatch={() => setWatching((now) => (now === item.jobId ? null : item.jobId))}
              />
            ))}
          </ul>
          {items.length > shown && (
            <button type="button" className={secondaryBtnCls} onClick={() => setShown((n) => n + PAGE_SIZE)}>Show more</button>
          )}
        </>
      )}
    </div>
  );
}
