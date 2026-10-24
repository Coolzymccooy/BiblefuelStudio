// The props of the "Cartoon" composition, built by
// server/src/lib/cartoon/renderData.js. Every time is in film seconds.

export type CartoonWord = { text: string; start: number; end: number };

/** One clip in the film: plays from its start for `trimTo` seconds, with its own sound. */
export type CartoonShot = {
  id: string;
  sceneId: string;
  from: number;
  to: number;
  src: string;
  trimTo: number;
  /** A soft dissolve in from the shot before (only where the scene changes). */
  dissolve: boolean;
};

export type CartoonCaption = {
  shotId: string;
  speaker: string;
  showName: boolean;
  from: number;
  to: number;
  words: CartoonWord[];
};

export type CartoonBed = {
  src: string;
  base: number;
  duck: number;
  windows: { from: number; to: number }[];
};

export type CartoonRenderData = {
  fps: number;
  width: number;
  height: number;
  total: number;
  verse: { reference: string; text: string; from: number; to: number };
  shots: CartoonShot[];
  captions: CartoonCaption[];
  captionsOn: boolean;
  bed: CartoonBed | null;
  endCard: { from: number; to: number; reference: string; text: string; brand: string };
  fonts: { sans?: string; serif?: string; serifItalic?: string };
};
