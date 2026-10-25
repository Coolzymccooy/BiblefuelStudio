// Shared pieces of the Showcase templates: the bouncy landing, a slowly
// drifting cover photo, and the scene backdrop each style's palette draws.
import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { SceneProps, ShowcasePalette } from "./types";

export const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const DISPLAY = "BF Display";
const PAPER = "#EFE6D2";
const DARK = "#0B0B0C";
/** Frames a photo takes to settle once it starts arriving. */
export const SETTLE_FRAMES = 15;

/**
 * The gap between photos arriving one after another: the template's usual rhythm, shortened when
 * the scene (a Hype scene runs a beat or two shorter) would otherwise cut before the last photo has
 * settled and been seen for as long as the others.
 */
export function staggerOf(rhythm: number, frames: number, count: number, settle = SETTLE_FRAMES): number {
  return Math.max(1, Math.min(rhythm, (frames - settle) / Math.max(1, count)));
}

/** A bouncy 0 to 1 that starts `at` frames into the scene. */
export function useLand(at: number, damping = 13) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - at, fps, config: { damping, stiffness: 140, mass: 0.8 } });
}

/** The solid colour behind tiles and strips in this scene. */
export function surfaceOf(palette: ShowcasePalette, index: number): string {
  if (palette.backdrop === "paper") return PAPER;
  if (palette.backdrop === "dark") return DARK;
  if (palette.backdrop === "colour" && palette.blocks?.length) return palette.blocks[index % palette.blocks.length];
  return palette.ink;
}

/** A photo filling its box, drifting between two zooms over the scene. */
export function Cover({ src, frames, zoom = [1, 1.08], position = "50% 40%" }: {
  src: string; frames: number; zoom?: [number, number]; position?: string;
}) {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, frames], zoom, { ...CLAMP, easing: Easing.bezier(0.33, 0, 0.67, 1) });
  return (
    <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: position, transform: `scale(${scale})` }} />
  );
}

/**
 * Behind cards: the scene's first photo blurred (blur styles), warm paper with a
 * soft vignette, a colour block, or near-black.
 */
export function Backdrop({ palette, index, images, photo }: Pick<SceneProps, "palette" | "index" | "images"> & { photo: number }) {
  if (palette.backdrop === "blur") {
    return (
      <AbsoluteFill>
        <Img src={images[photo].blur} style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scale(1.1)" }} />
        <AbsoluteFill style={{ backgroundColor: palette.ink, opacity: 0.35 }} />
      </AbsoluteFill>
    );
  }
  if (palette.backdrop === "paper") {
    return <AbsoluteFill style={{ backgroundColor: PAPER, backgroundImage: "radial-gradient(ellipse at 50% 45%, rgba(255,255,255,0.55) 0%, rgba(120,90,50,0.22) 100%)" }} />;
  }
  return <AbsoluteFill style={{ backgroundColor: surfaceOf(palette, index) }} />;
}

/**
 * One photo as large as the frame allows: filling the frame when its shape matches,
 * otherwise whole on its own blurred backdrop, so a wide photo is never cropped to a
 * tall frame (or a tall one to the cinema screen).
 */
export function WholePhoto({ props, photo, zoom, dim = false }: { props: SceneProps; photo: number; zoom: [number, number]; dim?: boolean }) {
  const frame = useCurrentFrame();
  const { frames, images, shape } = props;
  const image = images[photo];
  const scale = interpolate(frame, [0, frames], zoom, { ...CLAMP, easing: Easing.bezier(0.33, 0, 0.67, 1) })
    * interpolate(frame, [0, 5], [1.05, 1], CLAMP);
  const filter = dim ? "brightness(0.55) saturate(1.1)" : undefined;
  if (image.shape === shape) {
    return (
      <AbsoluteFill style={{ backgroundColor: "black", overflow: "hidden" }}>
        <Img src={image.card} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 38%", transform: `scale(${scale})`, filter }} />
      </AbsoluteFill>
    );
  }
  const pad = Math.round(Math.min(props.w, props.h) * 0.05);
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Backdrop palette={{ ...props.palette, backdrop: "blur" }} index={props.index} images={images} photo={photo} />
      <AbsoluteFill style={{ padding: pad, alignItems: "center", justifyContent: "center" }}>
        <Img src={image.card} style={{
          width: "100%", height: "100%", objectFit: "contain", transform: `scale(${scale})`,
          filter: `drop-shadow(0 24px 40px rgba(0,0,0,0.6))${dim ? " brightness(0.55)" : ""}`,
        }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
