import { lerp, num } from "./common.js";

/**
 * Entrances: how a shot arrives. They run last in the shot's graph (after
 * overlays), so a flash or glitch covers everything on screen.
 */
const entrance = (id, strong, graph) => ({ id, kind: "entrance", needs: [], strong, graph });

/**
 * Time-gated entrances read t from the input's own timestamps, so each one
 * first resets the input to frame count / fps. Without this, a shot whose
 * input starts later than 0 would never reach its window.
 */
const reset = (fps) => `setpts=N/${fps}/TB,`;

/** When the glitch is on screen, in seconds of the shot. Shared by its overlay and its colour branch. */
const GLITCH_WINDOW = "lt(t,0.14)+between(t,0.36,0.43)";

export const cut = entrance("cut", false, ({ input, output }) => [`${input}null${output}`]);

export const flash = entrance("flash", true, ({ input, output, shot, ctx }) => [
  `${input}${reset(ctx.fps)}fade=t=in:st=0:d=${num(lerp(0.12, 0.24, shot.move.intensity), 2)}:color=white${output}`,
]);

export const whip = entrance("whip", false, ({ input, output, ctx }) => [
  `${input}${reset(ctx.fps)}gblur=sigma=40:sigmaV=0.1:enable='lt(t,0.18)'${output}`,
]);

/**
 * The colour branch is gated to the glitch window too, so frames outside it
 * pass through untouched instead of being processed and then discarded by the overlay.
 */
export const glitch = entrance("glitch", true, ({ input, output, ctx, tag }) => [
  `${input}${reset(ctx.fps)}split[g${tag}a][g${tag}b]`,
  `[g${tag}b]rgbashift=rh=-24:bh=24:gv=10:enable='${GLITCH_WINDOW}',` +
    `noise=alls=40:allf=t:enable='${GLITCH_WINDOW}',` +
    `eq=contrast=1.3:enable='${GLITCH_WINDOW}'[g${tag}c]`,
  `[g${tag}a][g${tag}c]overlay=0:0:enable='${GLITCH_WINDOW}'${output}`,
]);

/**
 * A blend from the previous shot's last frame (a still, input ctx.prev) into
 * this shot. Both sides are normalised to the same size, pixel format and
 * frame rate, because xfade refuses mismatched inputs. Without a previous
 * frame (the first shot) it is a cut.
 */
export const crossfade = entrance("crossfade", false, ({ input, output, ctx, tag }) => {
  if (!ctx.prev) return [`${input}null${output}`];
  const d = Math.min(0.8, ctx.dur * 0.4);
  return [
    `${ctx.prev}scale=${ctx.w}:${ctx.h},setsar=1,format=yuv420p,loop=loop=${ctx.frames - 1}:size=1:start=0,setpts=N/${ctx.fps}/TB,fps=${ctx.fps}[xp${tag}]`,
    `${input}format=yuv420p,setsar=1,setpts=N/${ctx.fps}/TB,fps=${ctx.fps}[xc${tag}]`,
    `[xp${tag}][xc${tag}]xfade=transition=fade:duration=${num(d)}:offset=0${output}`,
  ];
});
