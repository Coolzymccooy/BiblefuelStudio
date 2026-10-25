// Templates that show several photos as cards or tiles: polaroids dropping
// in, a swipe stack, a grid popping in on the beat, and a split screen.
// Each lays out for the tall (9:16) or wide (16:9) frame.
import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, useCurrentFrame } from "remotion";
import { Backdrop, CLAMP, Cover, staggerOf, surfaceOf, useLand } from "./parts";
import type { SceneProps } from "./types";

const POLAROID = {
  tall: { width: 780, pad: 28, foot: 120, imgH: 900, spots: [{ x: 90, y: 210, rot: -7 }, { x: 220, y: 390, rot: 6 }, { x: 140, y: 570, rot: -3 }] },
  wide: { width: 520, pad: 22, foot: 90, imgH: 620, spots: [{ x: 190, y: 120, rot: -6 }, { x: 700, y: 170, rot: 4 }, { x: 1210, y: 110, rot: -3 }] },
} as const;

function Polaroid({ src, at, x, y, rot, shape, card, tape }: {
  src: string; at: number; x: number; y: number; rot: number; shape: "tall" | "wide"; card: string; tape: string | null;
}) {
  const p = useLand(at, 11);
  const size = POLAROID[shape];
  const drop = interpolate(p, [0, 1], [-1700, 0]);
  const turn = interpolate(p, [0, 1], [rot * 4, rot]);
  return (
    <div style={{
      position: "absolute", left: x, top: y, width: size.width, padding: `${size.pad}px ${size.pad}px ${size.foot}px`,
      backgroundColor: card, boxShadow: "0 30px 70px rgba(0,0,0,0.5)", transform: `translateY(${drop}px) rotate(${turn}deg)`,
    }}>
      <Img src={src} style={{ width: size.width - size.pad * 2, height: size.imgH, objectFit: "cover", display: "block" }} />
      {tape && (
        <div style={{
          position: "absolute", left: "50%", top: -26, width: 200, height: 56, marginLeft: -100,
          backgroundColor: tape, opacity: 0.7, transform: `rotate(${-rot * 0.8}deg)`,
        }} />
      )}
    </div>
  );
}

export function Polaroids(props: SceneProps) {
  const { scene, beat, shape, images, palette, frames } = props;
  const spots = POLAROID[shape].spots;
  const tape = palette.backdrop === "paper" ? palette.accent : null;
  const step = staggerOf(1.5 * beat, frames, scene.photos.length);
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Backdrop palette={palette} index={props.index} images={images} photo={scene.photos[0]} />
      {scene.photos.map((photo, i) => (
        <Polaroid key={i} src={images[photo].card} at={Math.round(i * step)} {...spots[i]} shape={shape} card={palette.card} tape={tape} />
      ))}
    </AbsoluteFill>
  );
}

const SWIPE_OUT_FRAMES = 12;

/** Dating-app style: the top card flies off on the beat to reveal the next. */
export function Swipe(props: SceneProps) {
  const frame = useCurrentFrame();
  const { scene, beat, shape, images, palette, w, frames } = props;
  const box = shape === "tall"
    ? { left: 90, top: 230, width: 900, height: 1420, radius: 40, border: 14, travel: 1500 }
    : { left: (w - 660) / 2, top: 50, width: 660, height: 960, radius: 34, border: 12, travel: 1600 };
  const cards = scene.photos.length;
  const step = staggerOf(1.6 * beat, frames, cards, SWIPE_OUT_FRAMES);
  const leaves = Array.from({ length: cards - 1 }, (_, i) => Math.round((i + 1) * step));
  const gone = leaves.filter((t) => frame >= t + 10).length;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Backdrop palette={palette} index={props.index} images={images} photo={scene.photos[0]} />
      {scene.photos.map((photo, i) => {
        const leaveAt = leaves[i];
        const out = leaveAt === undefined ? 0 : interpolate(frame, [leaveAt, leaveAt + SWIPE_OUT_FRAMES], [0, 1], { ...CLAMP, easing: Easing.in(Easing.cubic) });
        const depth = Math.max(0, i - gone);
        const dir = i % 2 === 0 ? 1 : -1;
        const dx = out * dir * box.travel + (shape === "wide" ? depth * 60 : 0);
        const dy = (shape === "wide" ? depth * 10 : depth * 46) - out * 120;
        return (
          <div key={i} style={{
            position: "absolute", left: box.left, top: box.top, width: box.width, height: box.height, borderRadius: box.radius,
            overflow: "hidden", border: `${box.border}px solid ${palette.card}`, boxShadow: "0 30px 70px rgba(0,0,0,0.5)", zIndex: 10 - i,
            transform: `translate(${dx}px, ${dy}px) rotate(${out * dir * 28}deg) scale(${1 - depth * 0.06})`,
          }}>
            <Img src={images[photo].card} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

function Tile({ src, at, left, top, width, height, frames, tilt, border }: {
  src: string; at: number; left: number; top: number; width: number; height: number; frames: number; tilt: number; border: string;
}) {
  const p = useLand(at, 10);
  return (
    <div style={{
      position: "absolute", left, top, width, height, overflow: "hidden", borderRadius: 18, border: `6px solid ${border}`,
      transform: `scale(${interpolate(p, [0, 1], [0.3, 1])}) rotate(${interpolate(p, [0, 1], [tilt * 5, 0])}deg)`,
      opacity: interpolate(p, [0, 0.2], [0, 1], CLAMP),
    }}>
      <Cover src={src} frames={frames} />
    </div>
  );
}

/** Four photos popping in on the beat: two by two on a tall frame, four across a wide one. */
export function Grid(props: SceneProps) {
  const { scene, beat, shape, images, palette, w, h, frames } = props;
  const pad = 36;
  const gap = 14;
  const cells = shape === "tall"
    ? [{ c: 0, r: 0 }, { c: 1, r: 1 }, { c: 1, r: 0 }, { c: 0, r: 1 }].map(({ c, r }) => {
      const tw = (w - pad * 2 - gap) / 2;
      const th = (h - pad * 2 - gap) / 2;
      return { left: pad + c * (tw + gap), top: pad + r * (th + gap), width: tw, height: th };
    })
    : [0, 1, 2, 3].map((i) => {
      const tw = (w - pad * 2 - gap * 3) / 4;
      return { left: pad + i * (tw + gap), top: pad, width: tw, height: h - pad * 2 };
    });
  const order = shape === "tall" ? [0, 1, 2, 3] : [0, 2, 1, 3];
  const step = staggerOf(beat, frames, scene.photos.length);
  return (
    <AbsoluteFill style={{ backgroundColor: surfaceOf(palette, props.index), overflow: "hidden" }}>
      {scene.photos.map((photo, i) => (
        <Tile key={i} src={images[photo].card} at={Math.round(order[i] * step)} {...cells[i]} frames={frames} tilt={i % 2 ? 3 : -3} border={palette.card} />
      ))}
    </AbsoluteFill>
  );
}

/** Two photos sliding in from opposite sides: stacked on a tall frame, side by side on a wide one. */
export function Split(props: SceneProps) {
  const { scene, beat, shape, images, palette, w, h, frames } = props;
  const first = useLand(0, 16);
  const second = useLand(Math.round(beat), 16);
  const gap = 16;
  const tall = shape === "tall";
  const size = tall ? { width: w, height: (h - gap) / 2 } : { width: (w - gap) / 2, height: h };
  const slide = (p: number, from: number) => (tall ? `translateX(${interpolate(p, [0, 1], [from * w, 0])}px)` : `translateY(${interpolate(p, [0, 1], [from * h, 0])}px)`);
  return (
    <AbsoluteFill style={{ backgroundColor: palette.accent, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, ...size, overflow: "hidden", transform: slide(first, -1) }}>
        <Cover src={images[scene.photos[0]].card} frames={frames} />
      </div>
      <div style={{
        position: "absolute", left: tall ? 0 : size.width + gap, top: tall ? size.height + gap : 0, ...size, overflow: "hidden", transform: slide(second, 1),
      }}>
        <Cover src={images[scene.photos[1]].card} frames={frames} zoom={[1.08, 1]} />
      </div>
    </AbsoluteFill>
  );
}
