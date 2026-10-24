/**
 * Cartoon mode (admin-only talking cartoon films) as the server sends it.
 * These mirror server/src/lib/cartoon (model.js, plan.js, shelf.js, styles.js,
 * examples.js) and the `view()` in server/src/routes/cartoon.js. Fields the
 * server leaves out until a step has happened are optional or nullable here:
 * a clip is null before filming, a portrait is null before it is made.
 */

export type CartoonPortraitStatus = 'making' | 'done' | 'error';

export interface CartoonPortrait {
  status: CartoonPortraitStatus;
  /** Public URL of the picture; null before the first successful make. */
  url: string | null;
  error: string | null;
  /** The style id it was drawn in; missing on portraits made before styles were recorded (counts as the current style). */
  style?: string | null;
}

export interface CartoonCastEntry {
  name: string;
  look: string;
  voice: string;
  /** Null until a portrait is made (or after the look changes). */
  portrait: CartoonPortrait | null;
  approved: boolean;
  /** The shelf character this member was pulled from, if any. */
  shelfId: string | null;
  /** True when pulled from the shelf in a different style than the cartoon's. */
  styleMismatch?: boolean;
}

/** `done` and `error` are the settled states; the rest are a clip on its way. */
export type CartoonClipStatus = 'queued' | 'generating' | 'done' | 'error' | 'refused' | 'waiting';

/** A finished or in-flight clip of an earlier order, kept so a re-make can be undone. */
export interface CartoonClipPrevious {
  status: CartoonClipStatus;
  taskId?: string | null;
  libraryId?: string;
  url?: string;
  posterUrl?: string | null;
  durationSec?: number;
  costUsd?: number;
  seconds?: number;
  prompt?: string;
}

export interface CartoonSpeechCheck {
  /** Null when the check itself could not run. */
  ok: boolean | null;
  heard?: string;
  score?: number;
  error?: string;
}

export interface CartoonClip {
  status: CartoonClipStatus;
  error?: string | null;
  seconds?: number;
  prompt?: string;
  /** Cast names whose portraits are sent as reference pictures. */
  references?: string[];
  libraryId?: string;
  url?: string;
  posterUrl?: string | null;
  durationSec?: number;
  costUsd?: number;
  /** What the speaker was heard to say, against the scripted line. */
  speech?: CartoonSpeechCheck | null;
  /** Stretches of the clip where someone is speaking, in seconds. */
  windows?: { from: number; to: number }[];
  /** Started from a last frame that has since been re-made. */
  stale?: boolean;
  previous?: CartoonClipPrevious | null;
  /** The BytePlus task this clip came from, or is being made by. */
  taskId?: string | null;
  /** The task whose cost has been counted for this shot. */
  chargedTaskId?: string | null;
  /** When the task was ordered (ms since epoch). */
  startedAt?: number;
  /** False once waiting again on a paid task ended in a definite failure: the next order is a new one. */
  refetchable?: boolean;
  /** Why a re-make made nothing; the clip shown is the earlier one, kept. */
  remakeError?: string | null;
  /** A paid re-make that could not be downloaded, which ordering the shot again fetches at no cost. */
  remake?: Pick<CartoonClip, 'taskId' | 'chargedTaskId' | 'startedAt' | 'seconds' | 'prompt' | 'references'> | null;
}

export type CartoonFirstFrame = 'fresh' | 'chain';

export interface CartoonShot {
  id: string;
  sceneId: string;
  /** Null for a silent shot. */
  speaker: string | null;
  /** The spoken words; null for a silent shot. */
  line: string | null;
  /** What happens in a silent shot or beside the line; null when nothing is described. */
  action: string | null;
  note: string;
  seconds: number;
  firstFrame: CartoonFirstFrame;
  /** Null before the shot is ordered. */
  clip: CartoonClip | null;
}

export interface CartoonScene { id: string; place: string; note: string }

/** The length check of a film: story seconds plus both cards against the 40 s limit. */
export interface CartoonCheck {
  storySec: number;
  filmSec: number;
  ok: boolean;
  overBySec: number;
  trimScene: { id: string; place: string } | null;
  tooLong: { shotId: string; words: number }[];
  tooMany: boolean;
}

/** What ordering would cost: clips still to make, portraits still to draw, and the spend so far. */
export interface CartoonEstimate {
  /** Clips to order and pay for. */
  clips: number;
  /** Clips already paid for that ordering only fetches again, at no cost. */
  refetch?: number;
  seconds: number;
  usd: number;
  images: number;
  imageUsd: number;
  spentUsd: number;
  totalUsd: number;
  benchmarkUsd: number;
  overBenchmark: boolean;
  shotIds: string[];
}

export type CartoonRenderStatus = 'idle' | 'queued' | 'rendering' | 'done' | 'error' | 'cancelled';

/** The render as the page sees it: the URL, never the stored file name. */
export interface CartoonRender {
  status: CartoonRenderStatus;
  error?: string | null;
  progress?: number;
  url?: string;
  sizeBytes?: number;
  durationSec?: number;
  renderSec?: number;
}

export interface CartoonProject {
  id: string;
  mode: 'cartoon';
  meta: {
    title: string;
    verse: { reference: string; text: string };
    aspect: 'portrait' | 'landscape' | 'square';
    /** A CartoonStyle id. */
    style: string;
  };
  source: {
    markdown: string;
    /** Lines the parser could not place, with their own text (server parse.js). */
    ignored: { lineNo: number; text: string }[];
    warnings: string[];
    parsedAt?: string;
  };
  cast: Record<string, CartoonCastEntry>;
  scenes: CartoonScene[];
  shots: CartoonShot[];
  shotListApproved: boolean;
  seed: number;
  music: { bed: string | null };
  captions: { enabled: boolean };
  endCard: { text: string };
  spentUsd: number;
  warnings: string[];
  createdAt?: number;
  updatedAt?: number;
  /** Derived by the server on every response. */
  check: CartoonCheck;
  fits: boolean;
  estimate: CartoonEstimate;
  running: { pictures: boolean; film: boolean; render: boolean };
  /** What stops the film from being ordered. */
  blockers: string[];
  render: CartoonRender;
  /** What stops a render. */
  renderBlockers: string[];
  /** Mentioned on the page but not blocking: shots made from an out-of-date frame. */
  renderWarnings: string[];
}

/** A pasted script read but not saved: the structure without ids, files or derived state. */
export type CartoonPreview = Pick<CartoonProject, 'meta' | 'cast' | 'scenes' | 'shots' | 'warnings'> & {
  id: 'preview';
  source: { ignored: CartoonProject['source']['ignored']; warnings: string[] };
};

export interface CartoonSummary {
  id: string;
  title: string;
  updatedAt: number;
  renderStatus: string;
  mode: 'cartoon';
}

export interface CartoonStyle { id: string; label: string }

export interface CartoonExample {
  id: string;
  title: string;
  verse: string;
  blurb: string;
  markdown: string;
}

/** A saved character that can be pulled into later cartoons. */
export interface ShelfCharacter {
  id: string;
  name: string;
  look: string;
  voice: string;
  /** The style it was made in; null if unknown. */
  style: string | null;
  portraitUrl: string;
  createdAt: number;
}

export interface CartoonMonth {
  spentUsd: number;
  capUsd: number;
  /** Held for clips ordered but not yet settled; counts against the cap. */
  reservedUsd?: number;
}

/** The fields PATCH /api/cartoon/:id accepts; anything else is ignored by the server. */
export interface CartoonEdit {
  title?: string;
  /** Replaces the script; refused once a clip has been ordered. */
  markdown?: string;
  style?: string;
  cast?: Record<string, { look?: string; voice?: string }>;
  shots?: { id: string; note?: string; firstFrame?: CartoonFirstFrame }[];
  captions?: { enabled: boolean };
  bed?: string | null;
  endCard?: { text: string };
}

/** Extra fields the server attaches to some error codes, reachable on `ApiError.payload`. */
export interface CartoonErrorPayload {
  /** NOT_READY. */
  blockers?: string[];
  /** CAST_NOT_READY: the characters still waiting for an approved portrait. */
  waiting?: string[];
  /** OVER_BENCHMARK. */
  estimate?: CartoonEstimate;
  /** TOO_LONG_FILM. */
  check?: CartoonCheck;
}
