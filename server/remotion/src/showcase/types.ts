// The props of the MomentShowcase composition: a Showcase plan
// (server/src/lib/showcase/director.js) plus where its staged images are.

export type ShowcaseShape = "tall" | "wide";

export type ShowcaseTemplate =
  | "single" | "spotlight" | "split" | "polaroids" | "swipe" | "triptych" | "grid" | "filmstrip" | "finale" | "invite";

export interface ShowcaseScene {
  template: ShowcaseTemplate;
  /** Indices into `images`. */
  photos: number[];
  start: number;
  end: number;
}

export interface ShowcasePalette {
  backdrop: "blur" | "paper" | "colour" | "dark";
  card: string;
  accent: string;
  ink: string;
  blocks?: string[];
}

export interface ShowcaseImage {
  /** The photo upright, long side at most 1400 px, aspect kept. */
  card: string;
  /** A tiny blurred cover of the photo for backdrops. */
  blur: string;
  shape: ShowcaseShape;
}

export interface ShowcaseProps {
  fps: number;
  w: number;
  h: number;
  durationSec: number;
  shape: ShowcaseShape;
  beatSec: number;
  scenes: ShowcaseScene[];
  flashes: number[];
  invite: { day: number; label: string } | null;
  palette: ShowcasePalette;
  letterbox: boolean;
  images: ShowcaseImage[];
  fonts: { display?: string };
}

/** What every template receives. */
export interface SceneProps {
  scene: ShowcaseScene;
  /** The scene's index, so colour-block backdrops can cycle. */
  index: number;
  /** The scene's length in frames. */
  frames: number;
  /** One beat in frames. */
  beat: number;
  shape: ShowcaseShape;
  w: number;
  h: number;
  palette: ShowcasePalette;
  images: ShowcaseImage[];
  invite: ShowcaseProps["invite"];
}
