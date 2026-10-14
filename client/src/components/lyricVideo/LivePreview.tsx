import { useEffect, useRef, useState } from 'react';
import JASSUB from 'jassub';
import workerUrl from 'jassub/dist/jassub-worker.js?url';
import wasmUrl from 'jassub/dist/jassub-worker.wasm?url';
import modernWasmUrl from 'jassub/dist/jassub-worker-modern.wasm?url';
import { api } from '../../lib/api';
import { lyricVideoApi } from '../../lib/lyricVideoApi';
import { CAPTION_FALLBACK_FONT, CAPTION_FONTS } from '../../lib/lyricPreviewFonts';
import { chooseBackdropFit } from '../../lib/lyricPreviewFit';
import { LyricBackdrop } from './LyricBackdrop';
import type { LyricProject } from '../../lib/lyricVideoTypes';

/** The size the captions are laid out at (the tall, Shorts-safe frame); the canvas scales to the box. */
const PREVIEW_W = 360;
const PREVIEW_H = 640;

/** A caption file with nothing in it: what the renderer is given once no line is placed any more. */
const BLANK_CAPTIONS = [
  '[Script Info]',
  'ScriptType: v4.00+',
  `PlayResX: ${PREVIEW_W}`,
  `PlayResY: ${PREVIEW_H}`,
  '',
  '[Events]',
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  '',
].join('\n');

interface Props { project: LyricProject; assVersion: number; onTime?: (t: number) => void }

/**
 * A song file has no picture, so its video element reports a size of 0 x 0 and the caption
 * renderer cannot work out where to draw. Tell it the frame the captions were laid out for.
 */
function reportPreviewSize(video: HTMLVideoElement): void {
  Object.defineProperty(video, 'videoWidth', { configurable: true, get: () => PREVIEW_W });
  Object.defineProperty(video, 'videoHeight', { configurable: true, get: () => PREVIEW_H });
}

function playQuietly(media: HTMLMediaElement): void {
  // A browser may refuse to start playback by script; the song's own controls still work.
  const started = media.play() as Promise<void> | undefined;
  if (started && typeof started.catch === 'function') started.catch(() => undefined);
}

/**
 * The song over its background with the captions drawn live by libass in the browser, from the
 * same caption file the render uses. A change to timing, effects or look swaps the captions
 * without reloading the video.
 *
 * The song's own player is the clock the captions follow, so seeking, pausing and the
 * transport controls all stay true. A video background plays muted and looped underneath it.
 */
export function LivePreview({ project, assVersion, onTime }: Props) {
  const song = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<{ url: string; width: number; height: number } | null>(null);
  const renderer = useRef<JASSUB | null>(null);

  const songUrl = api.mediaUrl(project.song?.file) || undefined;
  // What the render draws under the captions: the chosen background, else the cover still.
  const background = project.background;
  const backdropFile = background?.file ?? project.song?.coverStill ?? null;
  const backdropUrl = api.mediaUrl(backdropFile) || undefined;
  const backdropIsVideo = background?.kind === 'video';
  const requestedFit = background?.fit ?? 'auto';
  const size = measured && measured.url === backdropUrl ? measured : null;
  const fit = requestedFit === 'auto'
    ? chooseBackdropFit(size, { width: PREVIEW_W, height: PREVIEW_H })
    : requestedFit;

  // One renderer per project: a different project gets a fresh one, and none outlives the preview.
  useEffect(() => () => { renderer.current?.destroy(); renderer.current = null; }, [project.projectId]);

  useEffect(() => {
    let cancelled = false;
    lyricVideoApi.captions(project.projectId, PREVIEW_W, PREVIEW_H).then((text) => {
      const clock = song.current;
      if (cancelled || !clock) return;
      const live = renderer.current;
      if (live) {
        live.setTrack(text || BLANK_CAPTIONS);
        // Redraw at the current moment so a paused preview shows the change straight away.
        live.setCurrentTime(clock.paused, clock.currentTime);
        return;
      }
      if (!text) return; // nothing timed yet: the song plays with no captions
      reportPreviewSize(clock);
      renderer.current = new JASSUB({
        video: clock,
        subContent: text,
        workerUrl,
        wasmUrl,
        modernWasmUrl,
        availableFonts: { ...CAPTION_FONTS },
        fallbackFont: CAPTION_FALLBACK_FONT,
        // A song has no picture frames for the renderer to follow, so it keeps time from the
        // player's own clock instead.
        onDemandRender: false,
        targetFps: 30,
      });
    }).catch(() => { /* the timing list is still there without a preview */ });
    return () => { cancelled = true; };
  }, [project.projectId, assVersion]);

  /** Every video copy of the background (a whole picture has two: the sharp one and its blurred fill). */
  const backdropVideos = () => Array.from(frame.current?.querySelectorAll<HTMLVideoElement>('video[data-backdrop]') ?? []);

  /** Puts a looping background at the place in its loop that the song's time implies. */
  const align = (bg: HTMLVideoElement) => {
    const clock = song.current;
    if (!clock || !Number.isFinite(bg.duration) || bg.duration <= 0) return;
    bg.currentTime = clock.currentTime % bg.duration;
  };

  const startBackdrop = (bg: HTMLVideoElement) => { align(bg); playQuietly(bg); };

  return (
    <div
      ref={frame}
      data-testid="lyric-preview"
      className="relative mx-auto w-full max-w-[360px] overflow-hidden rounded-xl bg-[#101820]"
      style={{ aspectRatio: `${PREVIEW_W} / ${PREVIEW_H}` }}
    >
      {backdropUrl && (
        <LyricBackdrop
          url={backdropUrl}
          isVideo={backdropIsVideo}
          fit={fit}
          onSize={(width, height) => setMeasured({ url: backdropUrl, width, height })}
          onVideoReady={(bg) => { if (song.current && !song.current.paused) startBackdrop(bg); else align(bg); }}
        />
      )}
      {/*
        The song's own player: a transport over the picture, and the clock the captions follow. A song
        uploaded as a video file would show its own picture, which the render never draws, so the
        picture is pushed out of the box (the native controls and the caption canvas stay).
      */}
      <video
        ref={song}
        src={songUrl}
        controls
        playsInline
        preload="metadata"
        className="absolute inset-0 h-full w-full bg-transparent object-none [object-position:100000px_100000px]"
        onPlay={() => backdropVideos().forEach(startBackdrop)}
        onPause={() => backdropVideos().forEach((bg) => bg.pause())}
        onEnded={() => backdropVideos().forEach((bg) => bg.pause())}
        onSeeked={() => { backdropVideos().forEach(align); onTime?.(song.current?.currentTime ?? 0); }}
        onTimeUpdate={() => {
          const clock = song.current;
          if (!clock) return;
          // The browser may have paused a muted background (not loaded yet, or to save power):
          // pick it back up while the song is playing.
          if (!clock.paused) backdropVideos().forEach((bg) => { if (bg.paused) playQuietly(bg); });
          onTime?.(clock.currentTime);
        }}
      />
    </div>
  );
}
