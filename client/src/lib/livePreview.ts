/**
 * What the stage should show at a given playhead position.
 *
 * The stage previously had three states: rendering, a finished render, or the
 * text "Preview appears here after a render." Adding a clip, a background or a
 * caption changed nothing on screen until ffmpeg produced a file — so the
 * operator could not see the cut they were assembling. CapCut composites live;
 * this is the equivalent, done in the browser.
 *
 * It is an APPROXIMATION, deliberately: real compositing (xfade, glow, light
 * leaks) belongs to ffmpeg. What this gives is the correct clip, background,
 * caption and colour look at a moment in time — enough to judge the cut.
 *
 * PURE: it reads a project and returns a description. The component turns that
 * into DOM.
 */
import type { TimelineProject, TimelineEffectKind } from './timelineProject';

export interface PreviewLayer {
  role: 'background' | 'video' | 'broll';
  kind: 'image' | 'video';
  src: string;
  /** Where to seek within the source, for video layers. */
  seekSec: number;
  /** Stable across frames so React reuses the element instead of remounting. */
  key: string;
}

export interface PreviewFrame {
  layers: PreviewLayer[];
  caption?: string;
  grade?: string;
  isEmpty: boolean;
}

export interface PreviewBackground {
  id: string;
  url: string;
  kind?: 'image' | 'video';
}

export interface ResolveInput {
  timeSec: number;
  backgrounds: PreviewBackground[];
  captionLines?: string[];
  totalSec?: number;
  /** Media-base resolver. Defaults to identity so tests stay simple. */
  resolveUrl?: (p: string) => string;
}

/**
 * Turn a stored asset path into something a browser can actually load.
 *
 * Assets arrive in three shapes: an absolute URL (Veo/Pexels), a root-relative
 * served path (/outputs/...), or a BARE STORAGE KEY like `uploads/bg.jpg`.
 * The preview originally used the raw value, so the third shape rendered as a
 * broken image - the operator saw an empty frame with a broken-image icon.
 *
 * @param resolve Injected media-base resolver (api.mediaUrl), so this stays pure.
 */
export function toPlayableUrl(
  raw: string | undefined | null,
  resolve: (p: string) => string,
): string {
  const p = String(raw || '').trim();
  if (!p) return '';
  // Already loadable: absolute, protocol-relative, blob/data, or server-rooted.
  if (/^(https?:|blob:|data:|\/\/)/i.test(p)) return p;
  if (p.startsWith('/')) return p;
  return resolve(p);
}

function isImagePath(p: string): boolean {
  return /\.(jpe?g|png|webp|gif|avif)$/i.test(p);
}

/** The clip on `trackKind` covering `timeSec`, if any. */
function clipAt(project: TimelineProject, trackKind: string, timeSec: number) {
  const track = project.tracks.find((t) => t.kind === trackKind);
  if (!track) return null;
  return (
    track.clips.find(
      (c) => timeSec >= c.startSec && timeSec < c.startSec + c.durationSec,
    ) || null
  );
}

export function resolvePreviewFrame(
  project: TimelineProject,
  input: ResolveInput,
): PreviewFrame {
  const { timeSec } = input;
  const resolve = input.resolveUrl || ((p: string) => p);
  const layers: PreviewLayer[] = [];

  // Background sits BEHIND everything. With several selected they divide the
  // runtime evenly, which is how the renderer sequences them.
  if (input.backgrounds.length > 0) {
    const total = Math.max(1, input.totalSec ?? project.targetDurationSec);
    const each = total / input.backgrounds.length;
    const idx = Math.min(
      input.backgrounds.length - 1,
      Math.max(0, Math.floor(timeSec / each)),
    );
    const bg = input.backgrounds[idx];
    if (bg?.url) {
      layers.push({
        role: 'background',
        kind: bg.kind === 'image' || isImagePath(bg.url) ? 'image' : 'video',
        src: toPlayableUrl(bg.url, resolve),
        seekSec: Math.max(0, timeSec - each * idx),
        key: `bg-${bg.id}`,
      });
    }
  }

  // Base video, then b-roll ON TOP — b-roll is a cutaway, so it must win.
  for (const role of ['video', 'broll'] as const) {
    const clip = clipAt(project, role, timeSec);
    if (!clip) continue;
    const asset = project.assets[clip.assetId];
    const src = asset?.proxyPath && asset.proxyStatus === 'ready'
      ? asset.proxyPath
      : asset?.path;
    if (!src) continue;
    layers.push({
      role,
      kind: asset?.kind === 'image' || isImagePath(src) ? 'image' : 'video',
      src: toPlayableUrl(src, resolve),
      seekSec: Math.max(0, timeSec - clip.startSec) + (clip.sourceStartSec || 0),
      key: `${role}-${clip.id}`,
    });
  }

  // Caption for this moment. Lines are spread evenly across the runtime, which
  // matches how the caption burner distributes them without word timings.
  let caption: string | undefined;
  const lines = input.captionLines || [];
  if (lines.length > 0) {
    const total = Math.max(1, input.totalSec ?? project.targetDurationSec);
    const each = total / lines.length;
    const idx = Math.min(lines.length - 1, Math.max(0, Math.floor(timeSec / each)));
    caption = lines[idx];
  }

  // A grade in force right now, so the preview carries the colour look.
  let grade: string | undefined;
  const effectsTrack = project.tracks.find((t) => t.kind === 'effects');
  const activeGrade = effectsTrack?.clips.find(
    (c) =>
      (c.effect as TimelineEffectKind) === 'grade' &&
      timeSec >= c.startSec &&
      timeSec < c.startSec + c.durationSec,
  );
  if (activeGrade) grade = activeGrade.effectOptions?.look;

  return { layers, caption, grade, isEmpty: layers.length === 0 };
}

/** CSS filters approximating the server's GRADE_LOOKS. Preview only. */
export const GRADE_CSS: Record<string, string> = {
  warm: 'saturate(1.12) contrast(1.06) brightness(1.02) sepia(0.08)',
  cool: 'saturate(0.95) contrast(1.08) hue-rotate(-8deg)',
  cinematic: 'saturate(0.92) contrast(1.15) brightness(0.98)',
  vivid: 'saturate(1.3) contrast(1.12) brightness(1.03)',
};
