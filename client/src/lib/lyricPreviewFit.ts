export type BackdropFit = 'cover' | 'contain';

/**
 * Whether the render fills the frame with a picture (cropping it) or shows it whole over a
 * blurred copy of itself. Mirrors chooseSceneFit in server/src/lib/story/sceneFraming.js for the
 * user's own media: a picture whose shape is within 15% of the frame's fills it, anything
 * further off is shown whole. Unknown sizes keep the fill.
 */
const OWN_MEDIA_TOLERANCE = 0.15;

export function chooseBackdropFit(
  media: { width: number; height: number } | null,
  frame: { width: number; height: number },
): BackdropFit {
  const mw = Number(media?.width);
  const mh = Number(media?.height);
  if (!(mw > 0 && mh > 0 && frame.width > 0 && frame.height > 0)) return 'cover';
  const ratio = (mw / mh) / (frame.width / frame.height);
  return Math.abs(Math.log(ratio)) <= Math.log(1 + OWN_MEDIA_TOLERANCE) ? 'cover' : 'contain';
}
