import { rotationFilter, swapsSides } from "../motion/prepare.js";

/**
 * A Showcase photo becomes two small images before the picture renders: an
 * upright card with its aspect kept (long side CARD_LONG_SIDE, enough for the
 * largest template at 1080p) and a tiny blurred cover in the frame's shape for
 * backdrops. Chrome never holds a full-size original, so a Moment of 100
 * photos stays light on a server with no swap.
 *
 * Rotation follows the EXIF tag with -noautorotate on the input, as in
 * motion/prepare.js: ffmpeg 8 auto-rotates JPEGs and 5.1 (prod) does not.
 */
export const CARD_LONG_SIDE = 1400;
export const BLUR_SIZE = Object.freeze({ tall: Object.freeze([216, 384]), wide: Object.freeze([384, 216]) });
const BLUR = "gblur=sigma=6,eq=brightness=-0.04:saturation=1.1";
const PANORAMA_MAX_RATIO = 4;

const input = (src) => ["-hide_banner", "-v", "error", "-y", "-noautorotate", "-i", src];
const withRotation = (rotate, chain) => (rotate ? `${rotate},${chain}` : chain);

/**
 * `width` and `height` are the STORED dimensions, before any rotation; `frame` is the Moment's shape.
 * @returns {{ shape: "tall"|"wide", card: string[], blur: string[] }}
 */
export function stageImageArgs({ src, card, blur, width, height, orientation, frame }) {
  const rotate = rotationFilter(orientation);
  const swaps = swapsSides(orientation);
  const w = swaps ? height : width;
  const h = swaps ? width : height;
  // Panoramas are centre-cropped to 4:1 first, so no template is handed a sliver.
  const panorama = w > PANORAMA_MAX_RATIO * h ? `crop='min(iw,ih*${PANORAMA_MAX_RATIO})':ih,` : "";
  const fit = `${panorama}scale=${CARD_LONG_SIDE}:${CARD_LONG_SIDE}:force_original_aspect_ratio=decrease,setsar=1`;
  const [bw, bh] = BLUR_SIZE[frame === "wide" ? "wide" : "tall"];
  const cover = `scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},${BLUR},setsar=1`;
  return {
    shape: w > h ? "wide" : "tall",
    card: [...input(src), "-vf", withRotation(rotate, fit), "-frames:v", "1", "-q:v", "3", card],
    blur: [...input(src), "-vf", withRotation(rotate, cover), "-frames:v", "1", "-q:v", "5", blur],
  };
}
