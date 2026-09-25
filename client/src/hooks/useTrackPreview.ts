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
 */
export function useTrackPreview() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<PlayableTrack[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playingAll, setPlayingAll] = useState(false);

  const halt = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
  };

  const stop = () => {
    halt();
    queueRef.current = [];
    setPlayingId(null);
    setPlayingAll(false);
  };

  const start = (track: PlayableTrack, onEnded: () => void) => {
    halt();
    const el = new Audio(track.url);
    audioRef.current = el;
    el.addEventListener('ended', onEnded);
    el.addEventListener('error', onEnded);
    setPlayingId(track.id);
    // A rejected play() (autoplay policy, blocked output) used to silently
    // snap the button back, which read as 'preview does nothing'. Say so.
    const attempt = el.play();
    if (attempt && typeof attempt.catch === 'function') {
      attempt.catch(() => { stop(); toast.error("Couldn't play the preview - check your audio output and try again"); });
    }
  };

  /** Toggle: the playing track stops; any other one switches to it. */
  const preview = (track: PlayableTrack) => {
    if (playingId === track.id && !playingAll) { stop(); return; }
    queueRef.current = [];
    setPlayingAll(false);
    start(track, () => setPlayingId(null));
  };

  const next = () => {
    const [head, ...rest] = queueRef.current;
    queueRef.current = rest;
    if (!head) { stop(); return; }
    start(head, next);
  };

  /** The whole list in order; calling it again stops. */
  const playAll = (tracks: PlayableTrack[]) => {
    if (playingAll) { stop(); return; }
    const playable = tracks.filter((t) => t.url);
    if (playable.length === 0) return;
    queueRef.current = playable;
    setPlayingAll(true);
    next();
  };

  useEffect(() => () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
  }, []);

  return { playingId, playingAll, preview, playAll, stop };
}
