// A Showcase Moment's picture (spec docs/superpowers/specs/2026-10-25-moments-
// showcase-styles-design.md, section 7.5): each planned scene drawn by its
// template, with the style's flashes, letterbox, warm tint and vignette.
// Silent: the server's finish pass adds the grade, captions and sound.
import React, { useState } from "react";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/fonts";
import { Grid, Polaroids, Split, Swipe } from "./cards";
import { Filmstrip, Finale, Invite, Single, Spotlight, Triptych } from "./frames";
import { CLAMP, DISPLAY } from "./parts";
import type { SceneProps, ShowcaseProps, ShowcaseTemplate } from "./types";

const TEMPLATES: Record<ShowcaseTemplate, (p: SceneProps) => React.ReactElement> = {
  single: Single, spotlight: Spotlight, split: Split, polaroids: Polaroids, swipe: Swipe,
  triptych: Triptych, grid: Grid, filmstrip: Filmstrip, finale: Finale, invite: Invite,
};
const FLASH_FRAMES = 8;
/** Letterbox bar height as a share of the frame height. */
const LETTERBOX = { tall: 0.06, wide: 0.08 } as const;

function Flash({ color }: { color: string }) {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{ backgroundColor: color, opacity: interpolate(frame, [0, FLASH_FRAMES], [0.85, 0], CLAMP) }} />;
}

export const MomentShowcase: React.FC<ShowcaseProps> = (props) => {
  const { fps } = useVideoConfig();
  const { scenes, palette, images, shape, w, h, beatSec, invite } = props;
  useState(() => {
    if (props.fonts.display) loadFont({ family: DISPLAY, url: props.fonts.display });
    return true;
  });
  const beat = Math.max(1, beatSec * fps);
  const warm = palette.backdrop === "blur" || palette.backdrop === "paper";
  const bar = Math.round(h * LETTERBOX[shape]);
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {scenes.map((scene, index) => {
        const from = Math.round(scene.start * fps);
        const frames = Math.max(1, Math.round(scene.end * fps) - from);
        const Template = TEMPLATES[scene.template];
        return (
          <Sequence key={index} from={from} durationInFrames={frames} premountFor={fps}>
            <Template scene={scene} index={index} frames={frames} beat={beat} shape={shape} w={w} h={h} palette={palette} images={images} invite={invite} />
          </Sequence>
        );
      })}
      {props.flashes.map((t, i) => (
        <Sequence key={`flash-${i}`} from={Math.round(t * fps)} durationInFrames={FLASH_FRAMES}>
          <Flash color={palette.card} />
        </Sequence>
      ))}
      {warm && <AbsoluteFill style={{ backgroundColor: palette.accent, mixBlendMode: "soft-light", opacity: 0.12 }} />}
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0,0,0,${warm ? 0.35 : 0.45}) 100%)` }} />
      {props.letterbox && (
        <>
          <div style={{ position: "absolute", left: 0, top: 0, width: w, height: bar, backgroundColor: "black" }} />
          <div style={{ position: "absolute", left: 0, bottom: 0, width: w, height: bar, backgroundColor: "black" }} />
        </>
      )}
    </AbsoluteFill>
  );
};
