import React from "react";
import { Composition } from "remotion";
import { SceneScriptVideo } from "./SceneScriptVideo";
import { CartoonVideo } from "./CartoonVideo";
import type { RenderData } from "./types";
import type { CartoonRenderData } from "./cartoonTypes";

// Only used when opening the composition in Remotion Studio; real renders
// always pass a full RenderData as inputProps.
const SAMPLE: RenderData = {
  fps: 30, width: 1080, height: 1920, total: 4, intro: 1.6, title: "Sample", reference: "John 3:16",
  captions: true, lines: [], voice: [], shots: [], music: [], drop: null, hit: null,
  heartbeat: null, impact: null, endCard: null, fonts: {}, brand: "BibleFuel Studio",
};

const CARTOON_SAMPLE: CartoonRenderData = {
  fps: 30, width: 1080, height: 1920, total: 5.5,
  verse: { reference: "Luke 15:4", text: "", from: 0, to: 2.5 },
  shots: [], captions: [], captionsOn: true, bed: null,
  endCard: { from: 2.5, to: 5.5, reference: "Luke 15:4", text: "Sample", brand: "BibleFuel Studio" },
  fonts: {},
};

export const Root: React.FC = () => (
  <>
    <Composition
      id="SceneScript"
      component={SceneScriptVideo as unknown as React.FC<Record<string, unknown>>}
      defaultProps={SAMPLE as unknown as Record<string, unknown>}
      durationInFrames={Math.ceil(SAMPLE.total * SAMPLE.fps)}
      fps={SAMPLE.fps}
      width={SAMPLE.width}
      height={SAMPLE.height}
      calculateMetadata={({ props }) => {
        const p = props as unknown as RenderData;
        return { durationInFrames: Math.max(1, Math.ceil(p.total * p.fps)), fps: p.fps, width: p.width, height: p.height };
      }}
    />
    <Composition
      id="Cartoon"
      component={CartoonVideo as unknown as React.FC<Record<string, unknown>>}
      defaultProps={CARTOON_SAMPLE as unknown as Record<string, unknown>}
      durationInFrames={Math.ceil(CARTOON_SAMPLE.total * CARTOON_SAMPLE.fps)}
      fps={CARTOON_SAMPLE.fps}
      width={CARTOON_SAMPLE.width}
      height={CARTOON_SAMPLE.height}
      calculateMetadata={({ props }) => {
        const p = props as unknown as CartoonRenderData;
        return { durationInFrames: Math.max(1, Math.round(p.total * p.fps)), fps: p.fps, width: p.width, height: p.height };
      }}
    />
  </>
);
