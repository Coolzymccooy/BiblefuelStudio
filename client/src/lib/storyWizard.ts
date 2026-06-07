import type { StoryProject, StoryScene, StoryStatus, StoryStyleOption } from './storyTypes';

export const STORY_STYLES: StoryStyleOption[] = [
  { id: 'cinematic-bible', label: 'Cinematic Bible', blurb: 'Dramatic, film-still lighting' },
  { id: 'modern-devotional', label: 'Modern Devotional', blurb: 'Soft, clean, calm tones' },
  { id: 'heavenly-atmosphere', label: 'Heavenly Atmosphere', blurb: 'Glowing light, ethereal' },
  { id: 'ancient-scripture', label: 'Ancient Scripture', blurb: 'Weathered, historical desert' },
];

const TRANSIENT: StoryStatus[] = ['transcribing', 'segmenting', 'generating_images', 'rendering'];

export function isTransientStatus(status: StoryStatus): boolean {
  return TRANSIENT.includes(status);
}

/** Which wizard step (1 upload, 2 review, 3 render) the project is in. */
export function deriveStep(project: StoryProject): 1 | 2 | 3 {
  if (project.status === 'rendering' || project.status === 'done') return 3;
  if (project.scenes.length > 0) return 2;
  return 1;
}

export function allScenesDone(scenes: StoryScene[]): boolean {
  return scenes.length > 0 && scenes.every((s) => s.imageStatus === 'done');
}

export function canRender(project: StoryProject): boolean {
  return allScenesDone(project.scenes);
}

export function imageCounts(scenes: StoryScene[]): { done: number; total: number } {
  return { done: scenes.filter((s) => s.imageStatus === 'done').length, total: scenes.length };
}

function fmt(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function sceneTimeLabel(scene: StoryScene): string {
  return `${fmt(scene.startMs)}–${fmt(scene.endMs)}`; // en-dash between the two times
}

export function progressLabel(status: StoryStatus): string {
  switch (status) {
    case 'transcribing': return 'Transcribing your audio…';
    case 'segmenting': return 'Breaking it into scenes…';
    case 'generating_images': return 'Generating images…';
    case 'rendering': return 'Rendering your video…';
    default: return 'Working…';
  }
}

// Stages the CLIENT drives via sequential awaits. If one of these is the live
// status while the client is idle (busy === false), the pipeline was interrupted
// (e.g. tab closed) and nothing is advancing it — so we offer Resume. NOTE:
// 'rendering' is deliberately excluded: it runs server-side (fire-and-forget),
// so the client is always idle during a *normal* render — treating it as stalled
// would show a spurious Resume banner over the render-progress overlay.
const CLIENT_DRIVEN_TRANSIENT: StoryStatus[] = ['transcribing', 'segmenting', 'generating_images'];

/**
 * A project is "stalled" when a client-driven stage is the live status but no
 * client request is currently driving it (busy === false) — i.e. the page was
 * reloaded after the client-orchestrated pipeline was interrupted. The UI
 * surfaces a Resume button in this case.
 */
export function isStalled(project: StoryProject, busy: boolean): boolean {
  return !busy && CLIENT_DRIVEN_TRANSIENT.includes(project.status);
}

const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

/** Compact relative time. `nowMs` is injected so the function is deterministic. */
export function relativeTime(ms: number, nowMs: number): string {
  const diff = Math.max(0, nowMs - ms);
  if (diff < MIN) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`;
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export type StatusTone = 'done' | 'error' | 'busy' | 'idle';

/** Pill label + tone for a project status. */
export function statusMeta(status: StoryStatus): { label: string; tone: StatusTone } {
  switch (status) {
    case 'done': return { label: 'Done', tone: 'done' };
    case 'error': return { label: 'Error', tone: 'error' };
    case 'rendering': return { label: 'Rendering', tone: 'busy' };
    case 'generating_images': return { label: 'Generating', tone: 'busy' };
    case 'transcribing': return { label: 'Transcribing', tone: 'busy' };
    case 'segmenting': return { label: 'Segmenting', tone: 'busy' };
    case 'ready_to_render': return { label: 'Ready', tone: 'idle' };
    case 'draft':
    default: return { label: 'Draft', tone: 'idle' };
  }
}
