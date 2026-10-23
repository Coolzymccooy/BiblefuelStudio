export type Word = { text: string; start: number; end: number };

export type Line = {
  id: string;
  kind: "narration" | "scripture" | "reference" | "chant";
  text: string;
  emphasis: boolean;
  start: number;
  dur: number;
  gap: number;
  words: Word[];
  label: string;
  reference: string;
};

export type Shot = { id: string; from: number; to: number; src: string; clipDur: number };

export type MusicSection = {
  id: string;
  src: string;
  from: number;
  to: number;
  base: number;
  first: boolean;
  gated: boolean;
};

export type RenderData = {
  fps: number;
  width: number;
  height: number;
  total: number;
  intro: number;
  title: string;
  reference: string;
  captions: boolean;
  lines: Line[];
  voice: { id: string; start: number; src: string }[];
  shots: Shot[];
  music: MusicSection[];
  drop: { from: number; to: number } | null;
  hit: number | null;
  heartbeat: { src: string; from: number; to: number } | null;
  impact: { src: string; at: number } | null;
  endCard: { reference: string; text: string; at: number } | null;
  fonts: { sans?: string; serif?: string; serifItalic?: string };
  brand: string;
};
