import { insertSourceMediaOnTimeline, type TimelineAspect, type TimelineProject } from './timelineProject';

export interface SourceMediaInfo { durationSec?: number | null; width?: number | null; height?: number | null }
export function sourceAspect(width: number, height: number): TimelineAspect {
  return width === height ? '1:1' : width < height ? '9:16' : '16:9';
}
/** Measured source length is independent of the composition's target and clip trim. */
export function insertMeasuredSource(project: TimelineProject, input: {
  path: string; label: string; kind: 'video' | 'audio' | 'image';
  proxyPath?: string; proxyStatus?: string; info: SourceMediaInfo;
  sourceStartSec?: number; durationSec?: number;
}): TimelineProject {
  const { info, kind } = input;
  const duration = kind === 'image' ? 5 : info.durationSec;
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) throw new Error('Could not measure source duration. Nothing was inserted.');
  const visual = kind !== 'audio';
  if (visual && !(Number.isFinite(info.width) && Number.isFinite(info.height) && info.width! > 0 && info.height! > 0)) throw new Error('Could not measure source dimensions. Nothing was inserted.');
  const aspect = visual ? sourceAspect(info.width!, info.height!) : undefined;
  // Only an entirely empty composition may adopt the first visual source format.
  const base = visual && project.tracks.every(t => t.clips.length === 0) ? { ...project, aspect: aspect! } : project;
  const trackKind = kind === 'audio' ? 'music' : kind === 'image' ? 'broll' : 'video';
  const track = base.tracks.find(t => t.kind === trackKind);
  if (!track || track.locked) throw new Error('The destination track is missing or locked. Nothing was inserted.');
  const startSec = Math.max(0, ...track.clips.map(c => c.startSec + c.durationSec));
  const sourceStartSec = input.sourceStartSec ?? 0;
  const requested = input.durationSec ?? duration - sourceStartSec;
  if (!Number.isFinite(sourceStartSec) || sourceStartSec < 0 || sourceStartSec >= duration || !Number.isFinite(requested) || requested <= 0) throw new Error('Invalid source trim. Nothing was inserted.');
  const clipDuration = Math.min(requested, duration - sourceStartSec, base.targetDurationSec - startSec);
  if (!(clipDuration >= 0.1)) throw new Error('No room remains in the target timeline. Nothing was inserted.');
  const next = insertSourceMediaOnTimeline(base, { ...input, durationSec: clipDuration, startSec });
  const lane = next.tracks.find(t => t.kind === trackKind)!;
  const clip = lane.clips.find(c => !track.clips.some(old => old.id === c.id))!;
  next.assets[clip.assetId] = { ...next.assets[clip.assetId], durationSec: duration, aspect, width: visual ? info.width! : undefined, height: visual ? info.height! : undefined };
  clip.sourceStartSec = sourceStartSec;
  clip.sourceDurationSec = clipDuration;
  return next;
}

/** Compatibility with older info servers; never use a proxy's dimensions/duration. */
export function browserSourceInfo(url: string, kind: 'video' | 'audio' | 'image'): Promise<SourceMediaInfo> {
  return new Promise((resolve, reject) => {
    const element = kind === 'image' ? new Image() : document.createElement(kind);
    const cleanup = () => { clearTimeout(timer); element.onload = null; element.onerror = null; if (element instanceof HTMLMediaElement) { element.onloadedmetadata = null; element.removeAttribute('src'); element.load(); } };
    const fail = () => { cleanup(); reject(new Error('Could not read source metadata. Nothing was inserted.')); };
    const timer = window.setTimeout(fail, 15000);
    element.onerror = fail;
    if (element instanceof HTMLImageElement) element.onload = () => { const info = { width: element.naturalWidth, height: element.naturalHeight }; cleanup(); resolve(info); };
    else { element.preload = 'metadata'; element.onloadedmetadata = () => { const info = { durationSec: element.duration, width: element instanceof HTMLVideoElement ? element.videoWidth : undefined, height: element instanceof HTMLVideoElement ? element.videoHeight : undefined }; cleanup(); resolve(info); }; }
    element.src = url;
  });
}
