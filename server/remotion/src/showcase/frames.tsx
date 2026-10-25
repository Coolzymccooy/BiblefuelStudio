// Templates that frame one to five photos as a whole: the single push-in, a
// spotlight iris, a three-panel wipe, a moving film strip, and the two
// closing scenes (a slow pull-out, or the same with a calendar invite).
import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, useCurrentFrame } from "remotion";
import { Backdrop, CLAMP, Cover, DISPLAY, WholePhoto, staggerOf, useLand } from "./parts";
import type { SceneProps } from "./types";

const STRIP = "#050403";
const STRIP_SURROUND = "#120C05";
const SPROCKET = "#F2E6C8";

export function Single(props: SceneProps) {
  // Alternate push-in and pull-out so consecutive singles never move the same way.
  const zoom: [number, number] = props.index % 2 === 0 ? [1, 1.08] : [1.08, 1];
  return <WholePhoto props={props} photo={props.scene.photos[0]} zoom={zoom} />;
}

export function Spotlight(props: SceneProps) {
  const frame = useCurrentFrame();
  const { scene, images, palette, w, h, frames } = props;
  const size = Math.round(Math.min(w, h) * 0.92);
  const r = interpolate(frame, [0, 16], [0, size / 2], { ...CLAMP, easing: Easing.out(Easing.cubic) });
  const cx = w / 2;
  const cy = props.shape === "tall" ? h * 0.46 : h / 2;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Backdrop palette={palette} index={props.index} images={images} photo={scene.photos[0]} />
      <div style={{ position: "absolute", left: cx - size / 2, top: cy - size / 2, width: size, height: size, clipPath: `circle(${r}px at 50% 50%)` }}>
        <Cover src={images[scene.photos[0]].card} frames={frames} zoom={[1.12, 1.02]} />
      </div>
      <div style={{
        position: "absolute", left: cx - r - 12, top: cy - r - 12, width: r * 2 + 24, height: r * 2 + 24, borderRadius: "50%",
        border: `12px solid ${palette.accent}`, opacity: interpolate(frame, [12, 24], [1, 0], CLAMP),
      }} />
    </AbsoluteFill>
  );
}

const WIPE_FRAMES = 12;

/** Three panels wiping in one after another, alternately from the top and the bottom. */
export function Triptych(props: SceneProps) {
  const frame = useCurrentFrame();
  const { scene, beat, images, palette, w, h, frames } = props;
  const col = w / 3;
  const step = staggerOf(beat * 0.8, frames, scene.photos.length, WIPE_FRAMES);
  return (
    <AbsoluteFill style={{ backgroundColor: palette.backdrop === "colour" ? palette.ink : "#0B0B0C", overflow: "hidden" }}>
      {scene.photos.map((photo, i) => {
        const p = interpolate(frame, [i * step, i * step + WIPE_FRAMES], [0, 1], { ...CLAMP, easing: Easing.out(Easing.cubic) });
        const fromTop = i % 2 === 0;
        const drift = interpolate(frame, [0, frames], fromTop ? [-30, 30] : [30, -30]);
        return (
          <div key={i} style={{
            position: "absolute", left: i * col + 4, top: 0, width: col - 8, height: h, overflow: "hidden",
            clipPath: fromTop ? `inset(0 0 ${(1 - p) * 100}% 0)` : `inset(${(1 - p) * 100}% 0 0 0)`,
          }}>
            <Img src={images[photo].card} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `translateY(${drift}px) scale(1.08)` }} />
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

/** A film strip running through the frame: down a tall one, across a wide one. */
export function Filmstrip(props: SceneProps) {
  const frame = useCurrentFrame();
  const { scene, images, w, h, frames, shape } = props;
  const tall = shape === "tall";
  const cell = tall ? { w: 800, h: 1080, gap: 44 } : { w: 600, h: 760, gap: 40 };
  const run = scene.photos.length * ((tall ? cell.h : cell.w) + cell.gap);
  const span = tall ? h : w;
  const offset = interpolate(frame, [0, frames], [span * 0.35, -(run - span * 0.6)]);
  const holes = `repeating-linear-gradient(to ${tall ? "bottom" : "right"}, transparent 0 22px, ${SPROCKET} 22px 52px, transparent 52px 74px)`;
  const stripW = tall ? cell.w + 140 : run + 200;
  const stripH = tall ? run + 200 : cell.h + 140;
  return (
    <AbsoluteFill style={{ backgroundColor: STRIP_SURROUND, overflow: "hidden" }}>
      <div style={{
        position: "absolute", width: stripW, height: stripH, backgroundColor: STRIP,
        left: tall ? (w - stripW) / 2 : 0, top: tall ? 0 : (h - stripH) / 2,
        transform: `${tall ? `translateY(${offset - 100}px)` : `translateX(${offset - 100}px)`} rotate(${tall ? -4 : -3}deg)`,
      }}>
        {[0, 1].map((side) => (
          <div key={side} style={tall
            ? { position: "absolute", top: 0, [side ? "right" : "left"]: 18, width: 28, height: stripH, background: holes, borderRadius: 6 }
            : { position: "absolute", left: 0, [side ? "bottom" : "top"]: 18, height: 28, width: stripW, background: holes, borderRadius: 6 }} />
        ))}
        {scene.photos.map((photo, i) => (
          <Img key={i} src={images[photo].card} style={{
            position: "absolute", width: cell.w, height: cell.h, objectFit: "cover",
            left: tall ? 70 : 100 + i * (cell.w + cell.gap), top: tall ? 100 + i * (cell.h + cell.gap) : 70,
          }} />
        ))}
      </div>
    </AbsoluteFill>
  );
}

export function Finale(props: SceneProps) {
  return <WholePhoto props={props} photo={props.scene.photos[0]} zoom={[1.12, 1]} />;
}

/** The closing scene with a calendar page for the next date, landing a beat in. */
export function Invite(props: SceneProps) {
  const { invite, palette, beat, shape, w } = props;
  const land = useLand(Math.round(beat * 2), 9);
  const card = shape === "tall" ? { width: 330, height: 360, left: (w - 330) / 2, top: 260 } : { width: 300, height: 330, left: w - 300 - 140, top: 110 };
  const band = Math.round(card.height * 0.27);
  return (
    <AbsoluteFill>
      <WholePhoto props={props} photo={props.scene.photos[0]} zoom={[1, 1.1]} dim />
      {invite && (
        <div style={{
          position: "absolute", ...card, borderRadius: 26, overflow: "hidden", backgroundColor: palette.card,
          boxShadow: "0 24px 50px rgba(0,0,0,0.55)", fontFamily: DISPLAY, color: palette.ink, textAlign: "center",
          transform: `scale(${land}) rotate(${interpolate(land, [0, 1], [-40, -6])}deg)`,
        }}>
          <div style={{ height: band, lineHeight: `${band + 4}px`, backgroundColor: palette.accent, fontSize: band * 0.75, letterSpacing: 4 }}>{invite.label}</div>
          <div style={{ fontSize: card.height * 0.58, lineHeight: `${card.height - band}px` }}>{invite.day}</div>
        </div>
      )}
    </AbsoluteFill>
  );
}
