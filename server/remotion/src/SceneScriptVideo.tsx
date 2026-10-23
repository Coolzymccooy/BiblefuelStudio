import React from "react";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Audio, Video } from "@remotion/media";
import { musicVolume } from "../../src/lib/sceneScript/mixCurve.js";
import { XFADE_SEC } from "../../src/lib/sceneScript/refine.js";
import type { RenderData, Shot } from "./types";
import { Captions, EndCard, OpeningTitle } from "./Captions";
import { useFonts } from "./fonts";

// Show the last frame of a clip that runs out before its place ends: from
// where the clip stopped, play a sliver so slowly it does not visibly move.
const HOLD_SPAN_SEC = 0.04;
const HOLD_END_GUARD_SEC = 0.08;

function ShotView({ slot, index, hit }: { slot: Shot; index: number; hit: number | null }) {
  const frame = useCurrentFrame(); // local to the Sequence
  const { fps } = useVideoConfig();
  const len = slot.to - slot.from + (index === 0 ? 0 : XFADE_SEC);
  const t = frame / fps;
  const fadeIn = index === 0
    ? interpolate(t, [0, 0.8], [0, 1], { extrapolateRight: "clamp" })
    : interpolate(t, [0, XFADE_SEC], [0, 1], { extrapolateRight: "clamp" });
  const kenBurns = interpolate(t, [0, len], [1.03, 1.1]);
  const hitLocal = hit === null ? -1 : hit - (slot.from - (index === 0 ? 0 : XFADE_SEC));
  const punch = hitLocal > 0 && hitLocal < len
    ? interpolate(t, [hitLocal, hitLocal + 0.12, hitLocal + 1.2], [0, 0.06, 0.02], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : 0;
  const { look } = slot;
  // The framing pans within the zoom's overflow ((zoom - 1) / 2 of the frame each side), exactly as
  // the refine preview does; the slow push-in and the hit's punch then scale that framed picture.
  const pan = (v: number) => -v * ((look.zoom - 1) / 2) * 100;
  const transform = `scale(${kenBurns + punch}) translate(${pan(look.x)}%, ${pan(look.y)}%) scale(${look.flip ? -look.zoom : look.zoom}, ${look.zoom})`;
  const playFrames = Math.max(1, Math.round((len - slot.hold) * fps));
  const holdFrom = Math.max(slot.trimFrom, slot.trimTo - HOLD_END_GUARD_SEC);
  const videoStyle = { width: "100%", height: "100%" };
  return (
    <AbsoluteFill style={{ opacity: fadeIn }}>
      <AbsoluteFill style={{ transform, filter: look.filter || undefined }}>
        <Sequence durationInFrames={playFrames} layout="none" name="clip">
          <Video src={slot.src} muted playbackRate={slot.rate} objectFit="cover" style={videoStyle}
            trimBefore={Math.round(slot.trimFrom * fps)} trimAfter={Math.round(slot.trimTo * fps)} />
        </Sequence>
        {slot.hold > 0 ? (
          <Sequence from={playFrames} layout="none" name="held last frame">
            <Video src={slot.src} muted playbackRate={HOLD_SPAN_SEC / 2 / slot.hold} objectFit="cover" style={videoStyle}
              trimBefore={Math.round(holdFrom * fps)} trimAfter={Math.round((holdFrom + HOLD_SPAN_SEC) * fps) + 1} />
          </Sequence>
        ) : null}
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
        const start = i === 0 ? 0 : slot.from - XFADE_SEC;
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
