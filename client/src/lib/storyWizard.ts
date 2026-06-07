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
