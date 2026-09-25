import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../lib/api';

export interface PlayableTrack {
  /** What the list calls this entry (a ref, a path, or a list key). */
  id: string;
  url: string;
}

/**
 * Where a track's audio can be played from: bundled tracks from /music, and
 * uploads (or a loose file path) from /outputs by file name. Empty when there
 * is nothing to play.
 */
export function trackAudioUrl(t: { previewUrl?: string | null; mediaFile?: string | null } | undefined, rawPath?: string): string {
  if (t?.previewUrl?.startsWith('/music/')) return `${api.baseUrl}${t.previewUrl}`;
  if (t?.mediaFile) return api.mediaUrl(t.mediaFile);
  if (rawPath && !/^(library|mylib):/.test(rawPath)) return api.mediaUrl(rawPath);
  return '';
}

/**
 * One audio element at a time for a music list: toggle a single preview, or
 * play the whole list in order ("Play all"). Starting either stops the other,
 * and nothing keeps playing once the list unmounts.
 *
 * Every element's events are checked against the CURRENT element: pausing a
 * track that is still loading rejects its play() with AbortError, and a failed
 * track in Play all fires `error` and then rejects too. Acting on those late
 * signals used to stop whatever had started since.
 */
export function useTrackPreview() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<PlayableTrack[]>([]);
  const allRef = useRef(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playingAll, setPlayingAll] = useState(false);

  const halt = () => {
    const el = audioRef.current;
    audioRef.current = null;
    if (el) { el.pause(); el.currentTime = 0; }
  };

  const stop = () => {
    halt();
    queueRef.current = [];
    allRef.current = false;
    setPlayingId(null);
    setPlayingAll(false);
  };

  const start = (track: PlayableTrack, onDone: () => void) => {
    halt();
    const el = new Audio(track.url);
    audioRef.current = el;
    const mine = () => audioRef.current === el;
    el.addEventListener('ended', () => { if (mine()) onDone(); });
    el.addEventListener('error', () => { if (mine()) onDone(); });
    setPlayingId(track.id);
    const attempt = el.play();
    if (attempt && typeof attempt.catch === 'function') {
      attempt.catch((e: unknown) => {
        if (!mine() || (e as Error)?.name === 'AbortError') return;
        // In Play all, a track that can't play is skipped; its `error` event
        // may already have moved on, which `mine()` accounts for.
        if (allRef.current) { onDone(); return; }
        stop();
        toast.error("Couldn't play the preview - check your audio output and try again");
      });
    }
  };

  const next = () => {
    const [head, ...rest] = queueRef.current;
    queueRef.current = rest;
    if (!head) { stop(); return; }
    start(head, next);
  };

  /** Toggle: the playing track stops (also mid Play all); any other one switches to it. */
  const preview = (track: PlayableTrack) => {
    if (playingId === track.id) { stop(); return; }
    queueRef.current = [];
    allRef.current = false;
    setPlayingAll(false);
    start(track, () => { if (!allRef.current) setPlayingId(null); });
  };

  /** The whole list in order; calling it again stops. */
  const playAll = (tracks: PlayableTrack[]) => {
    if (playingAll) { stop(); return; }
    const playable = tracks.filter((t) => t.url);
    if (playable.length === 0) return;
    queueRef.current = playable;
    allRef.current = true;
    setPlayingAll(true);
    next();
  };

  useEffect(() => () => {
    const el = audioRef.current;
    audioRef.current = null;
    el?.pause();
  }, []);

  return { playingId, playingAll, preview, playAll, stop };
}
