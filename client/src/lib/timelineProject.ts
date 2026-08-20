export type TimelineAspect = '16:9' | '9:16' | '1:1';
export type TimelineTrackKind = 'video' | 'broll' | 'voiceover' | 'music' | 'captions' | 'effects';
export type TimelineAssetKind = 'video' | 'audio' | 'image' | 'caption' | 'effect';
export type TimelineAssetSource = 'upload' | 'library' | 'veo' | 'imagegen' | 'chatterbox' | 'fish' | 'system';
export type TimelineFit = 'cover' | 'contain' | 'face-safe';

export interface TimelineAsset {
  id: string;
  kind: TimelineAssetKind;
  source: TimelineAssetSource;
  label: string;
  path?: string;
  proxyPath?: string;
  proxyStatus?: 'pending' | 'ready' | 'failed' | string;
  durationSec?: number;
  aspect?: TimelineAspect;
  prompt?: string;
  tags?: string[];
}

export interface TimelineClipTransform {
  fit: TimelineFit;
  x?: number;
  y?: number;
  zoom?: number;
}

export interface TimelineTransition {
  id: string;
  label: string;
  durationSec: number;
}

export interface TimelineClip {
  id: string;
  assetId: string;
  startSec: number;
  durationSec: number;
  sourceStartSec?: number;
  sourceDurationSec?: number;
  transform: TimelineClipTransform;
  transitionIn?: TimelineTransition;
  transitionOut?: TimelineTransition;
  muted?: boolean;
}

export interface TimelineTrack {
  id: string;
  kind: TimelineTrackKind;
  label: string;
  clips: TimelineClip[];
  locked?: boolean;
  muted?: boolean;
}

export interface TimelineSceneMarker {
  id: string;
  label: string;
  startSec: number;
  targetDurationSec: number;
  voiceoverBrief: string;
  audioRule: 'music_bed' | 'real_event_audio' | 'interview_audio' | 'mixed';
}

export interface TimelineRenderSettings {
  quality: 'proof_720p' | 'standard_1080p' | 'final_1080p';
  faceSafeDefault: boolean;
  voiceProvider: 'chatterbox' | 'fish' | 'azure' | 'elevenlabs' | 'edge';
  realEventAudioFor: string[];
  defaultTransition: TimelineTransition;
}

export interface TimelineProject {
  id: string;
  title: string;
  template: 'worship-documentary' | 'sermon-reel' | 'blank';
  aspect: TimelineAspect;
  targetDurationSec: number;
  assets: Record<string, TimelineAsset>;
  tracks: TimelineTrack[];
  scenes: TimelineSceneMarker[];
  renderSettings: TimelineRenderSettings;
  createdAt: string;
  updatedAt: string;
}

export interface BuildWorshipDocumentaryProjectInput {
  title: string;
  aspect?: TimelineAspect;
  targetDurationSec?: number;
}

const TRACKS: Array<{ kind: TimelineTrackKind; label: string }> = [
  { kind: 'video', label: 'Real footage' },
  { kind: 'broll', label: 'AI B-roll / cutaways' },
  { kind: 'voiceover', label: 'Voice-over' },
  { kind: 'music', label: 'Music bed' },
  { kind: 'captions', label: 'Captions' },
  { kind: 'effects', label: 'Effects' },
];

const WORSHIP_SCENES: Array<Omit<TimelineSceneMarker, 'id' | 'startSec'>> = [
  {
    label: 'Opening / Arrival',
    targetDurationSec: 25,
    voiceoverBrief: 'Set the atmosphere and invite the viewer into the room.',
    audioRule: 'music_bed',
  },
  {
    label: 'Behind the scenes',
    targetDurationSec: 25,
    voiceoverBrief: 'Show the people and preparation behind the worship moment.',
    audioRule: 'music_bed',
  },
  {
    label: 'Interview / testimony',
    targetDurationSec: 35,
    voiceoverBrief: 'Let one strong human soundbite carry the heart of the event.',
    audioRule: 'interview_audio',
  },
  {
    label: 'Praise begins',
    targetDurationSec: 45,
    voiceoverBrief: 'Introduce the shift from expectation into praise.',
    audioRule: 'real_event_audio',
  },
  {
    label: 'Worship body',
    targetDurationSec: 70,
    voiceoverBrief: 'Let the real worship audio breathe; use captions sparingly.',
    audioRule: 'real_event_audio',
  },
  {
    label: 'Intense dance',
    targetDurationSec: 45,
    voiceoverBrief: 'Highlight the joy, energy and movement in the room.',
    audioRule: 'real_event_audio',
  },
  {
    label: 'Afterglow / closing',
    targetDurationSec: 25,
    voiceoverBrief: 'Close with gratitude, memory and an invitation to the next moment.',
    audioRule: 'mixed',
  },
];

function makeId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildWorshipDocumentaryProject({
  title,
  aspect = '16:9',
  targetDurationSec = 270,
}: BuildWorshipDocumentaryProjectInput): TimelineProject {
  const now = new Date().toISOString();
  let cursor = 0;
  const scenes = WORSHIP_SCENES.map((scene, index) => {
    const marker: TimelineSceneMarker = {
      ...scene,
      id: `scene-${index + 1}`,
      startSec: cursor,
    };
    cursor += scene.targetDurationSec;
    return marker;
  });

  return {
    id: makeId('timeline'),
    title,
    template: 'worship-documentary',
    aspect,
    targetDurationSec: Math.min(Math.max(30, targetDurationSec), 300),
    assets: {},
    tracks: TRACKS.map((track) => ({
      id: `track-${track.kind}`,
      kind: track.kind,
      label: track.label,
      clips: [],
    })),
    scenes,
    renderSettings: {
      quality: 'proof_720p',
      faceSafeDefault: true,
      voiceProvider: 'chatterbox',
      realEventAudioFor: ['praise', 'worship', 'dance'],
      defaultTransition: { id: 'crossfade', label: 'Crossfade', durationSec: 0.5 },
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function insertAssetOnTrack(
  project: TimelineProject,
  input: {
    trackKind: TimelineTrackKind;
    asset: TimelineAsset;
    startSec: number;
    durationSec?: number;
    fit?: TimelineFit;
  },
): TimelineProject {
  const durationSec = Math.max(0.1, input.durationSec ?? input.asset.durationSec ?? 5);
  const clip: TimelineClip = {
    id: makeId('clip'),
    assetId: input.asset.id,
    startSec: Math.max(0, input.startSec),
    durationSec,
    transform: { fit: input.fit ?? (project.renderSettings.faceSafeDefault ? 'face-safe' : 'cover') },
  };

  return {
    ...project,
    assets: {
      ...project.assets,
      [input.asset.id]: input.asset,
    },
    tracks: project.tracks.map((track) => (
      track.kind === input.trackKind
        ? { ...track, clips: [...track.clips, clip].sort((a, b) => a.startSec - b.startSec) }
        : track
    )),
    updatedAt: new Date().toISOString(),
  };
}

export interface TimelineStorageAdapter {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => unknown;
  removeItem?: (key: string) => unknown;
}

export const TIMELINE_PROJECT_STORAGE_KEY = 'biblefuel.aiDocumentaryTimelineProject.v1';

function getDefaultStorage(): TimelineStorageAdapter | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  return window.localStorage;
}

function isTimelineProject(value: unknown): value is TimelineProject {
  const candidate = value as TimelineProject;
  return Boolean(
    candidate &&
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    Array.isArray(candidate.tracks) &&
    Array.isArray(candidate.scenes) &&
    candidate.assets &&
    typeof candidate.assets === 'object',
  );
}

export function saveTimelineProject(project: TimelineProject, storage: TimelineStorageAdapter | null = getDefaultStorage()): boolean {
  if (!storage) return false;
  storage.setItem(TIMELINE_PROJECT_STORAGE_KEY, JSON.stringify(project));
  return true;
}

export function loadTimelineProject(storage: TimelineStorageAdapter | null = getDefaultStorage()): TimelineProject | null {
  if (!storage) return null;
  const raw = storage.getItem(TIMELINE_PROJECT_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return isTimelineProject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearTimelineProject(storage: TimelineStorageAdapter | null = getDefaultStorage()): boolean {
  if (!storage?.removeItem) return false;
  storage.removeItem(TIMELINE_PROJECT_STORAGE_KEY);
  return true;
}

export function insertSourceMediaOnTimeline(
  project: TimelineProject,
  input: {
    label: string;
    path: string;
    proxyPath?: string;
    proxyStatus?: 'pending' | 'ready' | 'failed' | string;
    kind: 'video' | 'audio' | 'image';
    durationSec?: number;
    startSec?: number;
  },
): TimelineProject {
  const targetTrackKind = input.kind === 'audio' ? 'music' : input.kind === 'image' ? 'broll' : 'video';
  const targetTrack = project.tracks.find((track) => track.kind === targetTrackKind);
  const appendStartSec = targetTrack?.clips.length
    ? Math.max(...targetTrack.clips.map((clip) => clip.startSec + clip.durationSec))
    : 0;
  const asset: TimelineAsset = {
    id: makeId('asset-upload'),
    kind: input.kind,
    source: 'upload',
    label: input.label,
    path: input.path,
    proxyPath: input.proxyPath,
    proxyStatus: input.proxyStatus,
    durationSec: input.durationSec,
    aspect: input.kind !== 'audio' ? project.aspect : undefined,
    tags: input.kind === 'video'
      ? ['real_footage', 'source_media']
      : input.kind === 'image'
        ? ['cutaway', 'source_image', 'broll']
        : ['source_audio'],
  };
  return insertAssetOnTrack(project, {
    trackKind: targetTrackKind,
    asset,
    startSec: input.startSec ?? appendStartSec,
    durationSec: input.durationSec ?? asset.durationSec ?? (input.kind === 'image' ? 5 : 30),
    fit: input.kind === 'video' ? 'face-safe' : 'contain',
  });
}

export function getTimelineAssetPreviewPath(asset: TimelineAsset | undefined | null): string {
  if (!asset) return '';
  if (asset.kind === 'video' && asset.proxyPath && asset.proxyStatus === 'ready') return asset.proxyPath;
  return asset.path || asset.proxyPath || '';
}

export function insertVoiceoverPlaceholderOnTimeline(
  project: TimelineProject,
  input: {
    label: string;
    text: string;
    startSec: number;
    durationSec?: number;
  },
): TimelineProject {
  const asset: TimelineAsset = {
    id: makeId('asset-vo'),
    kind: 'audio',
    source: 'chatterbox',
    label: input.label,
    durationSec: input.durationSec,
    prompt: input.text,
    tags: ['voiceover', 'chatterbox', 'placeholder'],
  };
  return insertAssetOnTrack(project, {
    trackKind: 'voiceover',
    asset,
    startSec: input.startSec,
    durationSec: input.durationSec ?? 6,
    fit: 'contain',
  });
}
