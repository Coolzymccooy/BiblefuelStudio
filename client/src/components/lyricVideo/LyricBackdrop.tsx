import type { BackdropFit } from '../../lib/lyricPreviewFit';

interface Props {
  url: string;
  isVideo: boolean;
  fit: BackdropFit;
  /** The picture's own size, once the browser knows it. */
  onSize: (width: number, height: number) => void;
  /** A video copy has just loaded: line it up with the song. */
  onVideoReady: (video: HTMLVideoElement) => void;
}

const FILL = 'absolute inset-0 h-full w-full';

/**
 * The picture under the captions, framed as the render frames it: filling the frame when it is the
 * frame's shape, otherwise shown whole over a blurred, slightly darkened copy of itself.
 * Every video copy carries data-backdrop so the player can keep them all in step with the song.
 */
export function LyricBackdrop({ url, isVideo, fit, onSize, onVideoReady }: Props) {
  const copy = (kind: 'blur' | 'whole' | 'fill', className: string) => {
    const hidden = kind === 'blur' ? 'true' : undefined;
    if (!isVideo) {
      return (
        <img
          key={kind}
          data-backdrop={kind}
          src={url}
          alt=""
          aria-hidden={hidden}
          className={className}
          onLoad={(e) => onSize(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
        />
      );
    }
    return (
      <video
        key={kind}
        data-backdrop={kind}
        src={url}
        muted
        loop
        playsInline
        preload="auto"
        aria-hidden="true"
        className={className}
        onLoadedMetadata={(e) => {
          onSize(e.currentTarget.videoWidth, e.currentTarget.videoHeight);
          onVideoReady(e.currentTarget);
        }}
      />
    );
  };

  if (fit !== 'contain') return copy('fill', `${FILL} object-cover`);
  return (
    <>
      {copy('blur', `${FILL} scale-110 object-cover blur-xl brightness-90`)}
      {copy('whole', `${FILL} object-contain`)}
    </>
  );
}
