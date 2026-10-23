import React from "react";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Audio, Video } from "@remotion/media";
import { musicVolume } from "../../src/lib/sceneScript/mixCurve.js";
import type { RenderData, Shot } from "./types";
import { Captions, EndCard, OpeningTitle } from "./Captions";
import { useFonts } from "./fonts";

const XFADE = 0.45; // seconds of cross-dissolve between shots

function ShotView({ slot, index, hit }: { slot: Shot; index: number; hit: number | null }) {
  const frame = useCurrentFrame(); // local to the Sequence
  const { fps } = useVideoConfig();
  const len = slot.to - slot.from + (index === 0 ? 0 : XFADE);
  const t = frame / fps;
  // Slow the clip just enough to fill its slot, never speed it up.
  const rate = Math.max(0.5, Math.min(1, (slot.clipDur - 0.08) / len));
  const fadeIn = index === 0
    ? interpolate(t, [0, 0.8], [0, 1], { extrapolateRight: "clamp" })
    : interpolate(t, [0, XFADE], [0, 1], { extrapolateRight: "clamp" });
  const scale = interpolate(t, [0, len], [1.03, 1.1]);
  const hitLocal = hit === null ? -1 : hit - (slot.from - (index === 0 ? 0 : XFADE));
  const punch = hitLocal > 0 && hitLocal < len
    ? interpolate(t, [hitLocal, hitLocal + 0.12, hitLocal + 1.2], [0, 0.06, 0.02], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : 0;
  return (
    <AbsoluteFill style={{ opacity: fadeIn }}>
      <AbsoluteFill style={{ transform: `scale(${scale + punch})` }}>
        <Video src={slot.src} muted playbackRate={rate} objectFit="cover" style={{ width: "100%", height: "100%" }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function Grade({ data }: { data: RenderData }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const drop = data.drop;
  const hit = data.hit;
  const dim = drop && hit !== null
    ? interpolate(t, [drop.from - 0.1, drop.from + 0.4, hit - 0.02, hit], [0, 0.72, 0.72, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : 0;
  const flash = hit !== null
    ? interpolate(t, [hit, hit + 0.08, hit + 0.7], [0, 0.85, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : 0;
  return (
    <>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 45%, rgba(0,0,0,0.55) 100%)" }} />
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(20,10,0,0.18), rgba(0,0,0,0) 30%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.45))" }} />
      <AbsoluteFill style={{ background: "#000", opacity: dim }} />
      <AbsoluteFill style={{ background: "#FFE9C2", opacity: flash, mixBlendMode: "screen" }} />
    </>
  );
}

export const SceneScriptVideo: React.FC<RenderData> = (data) => {
  useFonts(data.fonts);
  const { fps } = useVideoConfig();
  const f = (sec: number) => Math.max(0, Math.round(sec * fps));

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {data.shots.map((slot, i) => {
        const start = i === 0 ? 0 : slot.from - XFADE;
        return (
          <Sequence key={slot.id} from={f(start)} durationInFrames={Math.max(1, f(slot.to - start) + 1)} name={`shot ${slot.id}`}>
            <ShotView slot={slot} index={i} hit={data.hit} />
          </Sequence>
        );
      })}
      <Grade data={data} />
      <OpeningTitle data={data} />
      <Captions data={data} />
      <EndCard data={data} />

      {data.voice.map((v) => (
        <Sequence key={v.id} from={f(v.start)} name={`voice ${v.id}`}>
          <Audio src={v.src} />
        </Sequence>
      ))}

      {data.music.map((m) => (
        <Sequence key={m.id} from={f(m.from)} durationInFrames={Math.max(1, f(m.to - m.from))} name={`music ${m.id}`}>
          <Audio src={m.src} volume={(fr: number) => musicVolume(m, m.from + fr / fps, data.lines, data.drop)} />
        </Sequence>
      ))}

      {data.heartbeat ? (
        <Sequence from={f(data.heartbeat.from)} durationInFrames={Math.max(1, f(data.heartbeat.to - data.heartbeat.from))} name="heartbeat">
          <Audio src={data.heartbeat.src}
            volume={(fr: number) => {
              const len = data.heartbeat!.to - data.heartbeat!.from;
              return 0.38 * interpolate(fr / fps, [0, 1.5, Math.max(1.6, len - 4), Math.max(1.7, len)], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            }} />
        </Sequence>
      ) : null}
      {data.impact ? (
        <Sequence from={f(data.impact.at)} name="impact">
          <Audio src={data.impact.src} volume={0.85} />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};
