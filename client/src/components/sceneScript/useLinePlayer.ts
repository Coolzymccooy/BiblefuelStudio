import { useCallback, useEffect, useRef, useState } from 'react';

/** One shared audio element for previewing voiced lines: playing a line stops the last one. */
export function useLinePlayer() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  useEffect(() => () => { audio.current?.pause(); }, []);

  const toggle = useCallback((id: string, url: string) => {
    if (!audio.current) {
      audio.current = new Audio();
      audio.current.onended = () => setPlaying(null);
    }
    const el = audio.current;
    if (playing === id) {
      el.pause();
      setPlaying(null);
      return;
    }
    el.src = url;
    el.play().then(() => setPlaying(id)).catch(() => setPlaying(null));
  }, [playing]);

  return { playing, toggle };
}
