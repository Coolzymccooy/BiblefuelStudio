import { lerp, num } from "./common.js";

/**
 * Entrances: how a shot arrives. They run last in the shot's graph (after
 * overlays), so a flash or glitch covers everything on screen.
 */
const entrance = (id, strong, graph) => ({ id, kind: "entrance", needs: [], strong, graph });

export const cut = entrance("cut", false, ({ input, output }) => [`${input}null${output}`]);

export const flash = entrance("flash", true, ({ input, output, shot }) => [
  `${input}fade=t=in:st=0:d=${num(lerp(0.12, 0.24, shot.move.intensity), 2)}:color=white${output}`,
]);

export const whip = entrance("whip", false, ({ input, output }) => [
  `${input}gblur=sigma=40:sigmaV=0.1:enable='lt(t,0.18)'${output}`,
]);

export const glitch = entrance("glitch", true, ({ input, output, tag }) => [
  `${input}split[g${tag}a][g${tag}b]`,
  `[g${tag}b]rgbashift=rh=-24:bh=24:gv=10,noise=alls=40:allf=t,eq=contrast=1.3[g${tag}c]`,
  `[g${tag}a][g${tag}c]overlay=0:0:enable='lt(t,0.14)+between(t,0.36,0.43)'${output}`,
]);

/**
 * A blend from the previous shot's last frame (a still, input ctx.prev) into
 * this shot. Both sides are normalised to the same size, pixel format and
 * frame rate, because xfade refuses mismatched inputs. Without a previous
 * frame (the first shot) it is a cut.
 */
export const crossfade = entrance("crossfade", false, ({ input, output, ctx, tag }) => {
  if (!ctx.prev) return [`${input}null${output}`];
  const d = Math.min(0.5, ctx.dur * 0.4);
  return [
    `${ctx.prev}scale=${ctx.w}:${ctx.h},setsar=1,format=yuv420p,loop=loop=${ctx.frames - 1}:size=1:start=0,setpts=N/${ctx.fps}/TB,fps=${ctx.fps}[xp${tag}]`,
    `${input}format=yuv420p,setsar=1,setpts=N/${ctx.fps}/TB,fps=${ctx.fps}[xc${tag}]`,
    `[xp${tag}][xc${tag}]xfade=transition=fade:duration=${num(d)}:offset=0${output}`,
  ];
});
