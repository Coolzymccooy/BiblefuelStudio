import { useEffect, useRef } from 'react';
import JASSUB from 'jassub';
import workerUrl from 'jassub/dist/jassub-worker.js?url';
import wasmUrl from 'jassub/dist/jassub-worker.wasm?url';
import modernWasmUrl from 'jassub/dist/jassub-worker-modern.wasm?url';
import { api } from '../../lib/api';
import { lyricVideoApi } from '../../lib/lyricVideoApi';
import { CAPTION_FALLBACK_FONT, CAPTION_FONTS } from '../../lib/lyricPreviewFonts';
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
  const backdrop = useRef<HTMLVideoElement>(null);
  const renderer = useRef<JASSUB | null>(null);

  const songUrl = api.mediaUrl(project.song?.file) || undefined;
  const background = project.background;
  const backdropVideo = background?.kind === 'video' ? api.mediaUrl(background.file) || undefined : undefined;
  const stillFile = background?.kind === 'image' ? background.file : project.song?.coverStill;
  const stillUrl = backdropVideo ? undefined : api.mediaUrl(stillFile) || undefined;
  const fitClass = background?.fit === 'contain' ? 'object-contain' : 'object-cover';

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

  /** Keeps the looping background at the place in its loop that the song's time implies. */
  const alignBackdrop = () => {
    const clock = song.current;
    const bg = backdrop.current;
    if (!clock || !bg || !Number.isFinite(bg.duration) || bg.duration <= 0) return;
    bg.currentTime = clock.currentTime % bg.duration;
  };

  return (
    <div
      data-testid="lyric-preview"
      className="relative mx-auto w-full max-w-[360px] overflow-hidden rounded-xl bg-[#101820]"
      style={{ aspectRatio: `${PREVIEW_W} / ${PREVIEW_H}` }}
    >
      {backdropVideo && (
        <video
          ref={backdrop}
          src={backdropVideo}
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden="true"
          className={`absolute inset-0 h-full w-full ${fitClass}`}
        />
      )}
      {stillUrl && <img src={stillUrl} alt="" className={`absolute inset-0 h-full w-full ${fitClass} opacity-90`} />}
      <video
        ref={song}
        src={songUrl}
        controls
        playsInline
        preload="metadata"
        className="absolute inset-0 h-full w-full bg-transparent object-cover"
        onPlay={() => {
          const bg = backdrop.current;
          if (!bg) return;
          alignBackdrop();
          playQuietly(bg);
        }}
        onPause={() => backdrop.current?.pause()}
        onEnded={() => backdrop.current?.pause()}
        onSeeked={() => { alignBackdrop(); onTime?.(song.current?.currentTime ?? 0); }}
        onTimeUpdate={() => {
          const clock = song.current;
          if (!clock) return;
          // The browser may have paused the muted background (not loaded yet, or to save power):
          // pick it back up while the song is playing.
          const bg = backdrop.current;
          if (bg?.paused && !clock.paused) playQuietly(bg);
          onTime?.(clock.currentTime);
        }}
      />
    </div>
  );
}
