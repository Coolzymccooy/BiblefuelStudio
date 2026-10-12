import { assTime } from "../../kinetic/text.js";
import { FONT_ANTON, lerp, num } from "./common.js";

/**
 * Overlays: decoration on top of a shot. Video overlays add filters to the
 * shot's own graph; ASS overlays return Dialogue lines (global time, style
 * FX) that the finish stage draws over the whole video in one pass.
 */
const videoOverlay = (id, graph) => ({ id, kind: "overlay", needs: [], strong: false, graph });
const assOverlay = (id, assEvents) => ({ id, kind: "overlay", needs: [], strong: false, assEvents });

/**
 * A warm orange leak sweeping across for 0.9 s, screen-blended. It is drawn
 * at 270x480 and scaled up (geq per pixel at full size is slow), and both
 * sides blend in gbrp: a YUV screen blend tints the picture magenta.
 */
export const lightLeak = videoOverlay("lightLeak", ({ input, output, ctx, tag }) => {
  const G = "(max(0,1-hypot(X-W*(0.9-0.5*T/0.9),Y-H*0.25)/(W*0.95))*max(0,1-T/0.9))";
  return [
    `color=c=black:s=270x480:r=${ctx.fps}:d=${num(Math.min(ctx.dur, 0.9))},format=gbrp,` +
      `geq=r='255*${G}':g='150*${G}':b='60*${G}',scale=${ctx.w}:${ctx.h},format=gbrp[lk${tag}]`,
    `${input}format=gbrp[lb${tag}]`,
    `[lb${tag}][lk${tag}]blend=all_mode=screen:eof_action=pass${output}`,
  ];
});

/** A camera viewfinder: corner brackets, a blinking REC dot, labels, a running clock, centre cross. */
export const viewfinder = videoOverlay("viewfinder", ({ input, output, ctx }) => {
  const { w, h } = ctx;
  const c = "white@0.92";
  const L = 105;
  const T = 8;
  const I = 69;
  const corners = [
    [I, I, L, T], [I, I, T, L], [w - I - L, I, L, T], [w - I - T, I, T, L],
    [I, h - I - T, L, T], [I, h - I - L, T, L], [w - I - L, h - I - T, L, T], [w - I - T, h - I - L, T, L],
  ].map(([x, y, bw, bh]) => `drawbox=x=${x}:y=${y}:w=${bw}:h=${bh}:color=${c}:t=fill`);
  const filters = [
    ...corners,
    `drawbox=x=${I + 27}:y=${I + 45}:w=24:h=24:color=red@0.95:t=fill:enable='lt(mod(t,0.8),0.5)'`,
    `drawtext=fontfile='${FONT_ANTON}':text='REC':x=${I + 66}:y=${I + 36}:fontsize=45:fontcolor=white`,
    `drawtext=fontfile='${FONT_ANTON}':text='4K 60':x=w-tw-${I + 27}:y=${I + 36}:fontsize=39:fontcolor=white@0.9`,
    `drawtext=fontfile='${FONT_ANTON}':text='%{pts\\:hms}':x=${I + 27}:y=h-${I + 90}:fontsize=39:fontcolor=white@0.9`,
    `drawbox=x=w/2-45:y=h/2-1:w=90:h=3:color=white@0.6:t=fill`,
    `drawbox=x=w/2-1:y=h/2-45:w=3:h=90:color=white@0.6:t=fill`,
    `vignette=angle=0.55`,
  ];
  return [`${input}${filters.join(",")}${output}`];
});

const STAR = "m 0 -14 l 3 -3 14 0 3 3 0 14 -3 3 -14 0 -3 -3";
const CROSS = "m -14 -18 l 0 -4 14 -18 18 -14 4 0 18 14 14 18 0 4 -14 18 -18 14 -4 0 -18 -14";
const PLUS = "m -4 -18 l 4 -18 4 -4 18 -4 18 4 4 4 4 18 -4 18 -4 4 -18 4 -18 -4 -4 -4";
const GOLD = "&H33E6FF&";
const RAYS = ["&H3C3CFF&", "&H33E6FF&", "&H5AFF5A&", "&HFFC83C&", "&HFF64C8&", "&H00A5FF&"];

/** Gold and white stars twinkling up the middle of the frame. */
export const sparkles = assOverlay("sparkles", ({ shot, ctx, rnd }) => {
  const count = Math.round(lerp(8, 24, shot.move.intensity));
  const dur = shot.end - shot.start;
  const lines = [];
  for (let k = 0; k < count; k += 1) {
    const t = shot.start + (dur * k) / count;
    const end = Math.min(shot.end, t + 0.7);
    const x = Math.round(ctx.w * (0.15 + 0.7 * rnd()));
    const y = Math.round(ctx.h * (0.25 + 0.5 * rnd()));
    const dx = Math.round((rnd() - 0.5) * 90);
    const dy = Math.round(60 + rnd() * 90);
    const s = Math.round(100 + rnd() * 90);
    const col = rnd() > 0.5 ? GOLD : "&HFFFFFF&";
    lines.push(`Dialogue: 2,${assTime(t)},${assTime(end)},FX,,0,0,0,,{\\an5\\move(${x},${y},${x + dx},${y - dy})\\bord0\\shad0\\1c${col}\\fscx${s}\\fscy${s}\\t(0,350,\\fscx${Math.round(s * 1.6)}\\fscy${Math.round(s * 1.6)}\\frz90)\\fad(60,300)\\p1}${STAR}{\\p0}`);
  }
  return lines;
});

/** Hand-drawn crosses and pluses popping in around the edges. */
export const doodles = assOverlay("doodles", ({ shot, ctx, rnd }) => {
  const dur = shot.end - shot.start;
  const spots = [[0.12, 0.15], [0.85, 0.22], [0.8, 0.78], [0.18, 0.85]];
  return spots.map(([fx, fy], k) => {
    const t = shot.start + Math.min(dur * 0.6, k * 0.15);
    const x = Math.round(ctx.w * fx + (rnd() - 0.5) * 60);
    const y = Math.round(ctx.h * fy + (rnd() - 0.5) * 60);
    const shape = k % 2 === 0 ? CROSS : PLUS;
    return `Dialogue: 2,${assTime(t)},${assTime(shot.end)},FX,,0,0,0,,{\\an5\\pos(${x},${y})\\bord3\\3c&H000000&\\shad0\\1c&HFFFFFF&\\fscx60\\fscy60\\t(0,120,\\fscx160\\fscy160)\\t(120,220,\\fscx150\\fscy150)\\p1}${shape}{\\p0}`;
  });
});

/** The end card: a burst of coloured rays from the centre. */
export const rayBurst = assOverlay("rayBurst", ({ shot, ctx, rnd }) => {
  const lines = [];
  const cx = ctx.w / 2;
  const cy = ctx.h / 2;
  for (let k = 0; k < 48; k += 1) {
    const a = (k / 48) * Math.PI * 2 + rnd() * 0.1;
    const r0 = 60 + rnd() * 45;
    const r1 = 450 + rnd() * 390;
    const t0 = shot.start + rnd() * 0.15;
    const end = Math.min(shot.end, t0 + 0.9);
    const deg = Math.round((-a * 180) / Math.PI);
    const p = (r) => `${Math.round(cx + Math.cos(a) * r)},${Math.round(cy + Math.sin(a) * r)}`;
    lines.push(`Dialogue: 2,${assTime(t0)},${assTime(end)},FX,,0,0,0,,{\\an5\\move(${p(r0)},${p(r1)},0,700)\\frz${deg}\\bord0\\shad0\\blur2\\1c${RAYS[k % RAYS.length]}\\fad(0,350)\\p1}m 0 -4 l 51 -4 51 4 0 4{\\p0}`);
  }
  return lines;
});
