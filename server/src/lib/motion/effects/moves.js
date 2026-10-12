import { anchoredXY, lerp, num, zoompan } from "./common.js";

/**
 * Moves: how the photo fills the frame over the shot. Tall photos arrive as
 * a 2160x3840 working image (2x the output, so zooms are smooth); wide ones
 * at height 2160. zoompan clamps x/y to the picture, so offsets never show
 * an edge.
 */
const zoomMove = (id, build) => ({
  id, kind: "move", needs: [], shapes: ["tall"], strong: false,
  graph({ input, output, shot, ctx }) {
    const { z, x, y } = build(shot, ctx);
    return [zoompan({ input, output, z, x, y, ctx })];
  },
});

export const push = zoomMove("push", (shot, ctx) => {
  const gain = lerp(0.05, 0.14, shot.move.intensity);
  return { z: `1+${num(gain)}*on/${ctx.frames}`, ...anchoredXY(shot.anchor) };
});

export const punch = zoomMove("punch", (shot, ctx) => {
  const kick = lerp(0.12, 0.3, shot.move.intensity);
  return { z: `1.04+${num(kick)}*pow(max(0,1-on/7),2)+0.04*on/${ctx.frames}`, ...anchoredXY(shot.anchor) };
});

export const shake = zoomMove("shake", (shot, ctx) => {
  const amp = lerp(16, 48, shot.move.intensity);
  const { x, y } = anchoredXY(shot.anchor);
  return {
    z: `1.12+0.03*on/${ctx.frames}`,
    x: `${x}+${num(amp, 1)}*sin(on*2.3)*exp(-on/6)`,
    y: `${y}+${num(amp * 0.8, 1)}*cos(on*2.9)*exp(-on/6)`,
  };
});

export const still = zoomMove("still", (shot, ctx) => ({ z: `1.02+0.01*on/${ctx.frames}`, ...anchoredXY(shot.anchor) }));

/** A landscape photo: a 9:16 window travelling across it. */
export const pan = {
  id: "pan", kind: "move", needs: [], shapes: ["tall", "wide"], strong: false,
  graph({ input, output, ctx }) {
    return [
      `${input}loop=loop=${ctx.frames - 1}:size=1:start=0,settb=1/${ctx.fps},setpts=N,` +
        `crop=w='ih*${ctx.w}/${ctx.h}':h=ih:x='(iw-ow)*(0.15+0.7*t/${num(ctx.frames / ctx.fps)})':y=0,` +
        `scale=${ctx.w}:${ctx.h},setsar=1,fps=${ctx.fps}${output}`,
    ];
  },
};

/** Black gap, in pixels, between stacked split panels. */
const GAP = 4;

/**
 * n panels stacked with GAP px of black between them, each a band of the photo
 * slowly zooming, entering 0.15 s apart (the middle one mirrored in a triple).
 * Panels plus gaps fill the frame exactly: the last panel takes the remainder.
 * Each crop keeps its panel's own shape whichever side of the photo limits it,
 * so nothing is squashed.
 */
function split(n) {
  return {
    id: `split${n}`, kind: "move", needs: [], shapes: ["tall", "wide"], strong: true,
    graph({ input, output, ctx, tag }) {
      const ph = Math.floor((ctx.h - GAP * (n - 1)) / n);
      const bands = n === 3 ? [0.1, 0.5, 0.9] : [0.15, 0.75];
      const lines = [`${input}split=${n}${bands.map((_, k) => `[s${tag}${k}]`).join("")}`];
      bands.forEach((band, k) => {
        const flip = n === 3 && k === 1 ? ",hflip" : "";
        const panelH = k === n - 1 ? ctx.h - (n - 1) * (ph + GAP) : ph;
        lines.push(
          `[s${tag}${k}]crop=w='min(iw,ih*${ctx.w}/${panelH})':h='min(ih,iw*${panelH}/${ctx.w})':x='(iw-ow)/2':y='(ih-oh)*${num(band)}'${flip},` +
            `zoompan=z='1+0.06*on/${ctx.frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${ctx.frames}:s=${ctx.w}x${panelH}:fps=${ctx.fps}[p${tag}${k}]`,
        );
      });
      // (frames - 0.5) / fps: the background emits ceil(d * fps) = ctx.frames frames, no more.
      lines.push(`color=c=black:s=${ctx.w}x${ctx.h}:r=${ctx.fps}:d=${num((ctx.frames - 0.5) / ctx.fps, 4)}[bg${tag}]`);
      let cur = `[bg${tag}]`;
      bands.forEach((_, k) => {
        const out = k === n - 1 ? output : `[l${tag}${k}]`;
        lines.push(`${cur}[p${tag}${k}]overlay=0:${k * (ph + GAP)}:enable='gte(t,${num(k * 0.15, 2)})'${out}`);
        cur = out;
      });
      return lines;
    },
  };
}

export const split2 = split(2);
export const split3 = split(3);
