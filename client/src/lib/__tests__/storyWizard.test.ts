import { describe, it, expect } from 'vitest';
import {
  STORY_STYLES, deriveStep, isTransientStatus, allScenesDone,
  canRender, sceneTimeLabel, progressLabel, imageCounts, isStalled,
} from '../storyWizard';
import type { StoryProject, StoryScene } from '../storyTypes';

function scene(over: Partial<StoryScene> = {}): StoryScene {
  return {
    id: 'scene-001', text: 'x', startMs: 0, endMs: 8000, imagePrompt: 'p',
    imagePath: null, imageStatus: 'pending', promptEditedByUser: false, ...over,
  };
}
function project(over: Partial<StoryProject> = {}): StoryProject {
  return {
    projectId: 'p', title: 'T', style: 'cinematic-bible', status: 'draft',
    source: { audioPath: null, durationMs: 0 }, transcript: { words: [], hash: null },
    scenes: [], music: { path: null, volume: 0.3 }, captionPreset: 'default',
    render: { jobId: null, outputPath: null, status: null }, error: null,
    createdAt: 0, updatedAt: 0, ...over,
  };
}

describe('STORY_STYLES', () => {
  it('lists the 4 v1 styles matching the backend ids', () => {
    expect(STORY_STYLES.map((s) => s.id).sort()).toEqual(
      ['ancient-scripture', 'cinematic-bible', 'heavenly-atmosphere', 'modern-devotional'],
    );
  });
});

describe('deriveStep', () => {
  it('step 1 for a fresh draft', () => {
    expect(deriveStep(project({ status: 'draft' }))).toBe(1);
  });
  it('step 1 while transcribing/segmenting (no scenes yet)', () => {
    expect(deriveStep(project({ status: 'transcribing' }))).toBe(1);
    expect(deriveStep(project({ status: 'segmenting' }))).toBe(1);
  });
  it('step 2 once scenes exist (review)', () => {
    expect(deriveStep(project({ status: 'generating_images', scenes: [scene()] }))).toBe(2);
    expect(deriveStep(project({ status: 'ready_to_render', scenes: [scene()] }))).toBe(2);
  });
  it('step 3 while rendering or done', () => {
    expect(deriveStep(project({ status: 'rendering', scenes: [scene()] }))).toBe(3);
    expect(deriveStep(project({ status: 'done', scenes: [scene()] }))).toBe(3);
  });
  it('error during transcribe (no scenes) stays on step 1; error during images stays on step 2', () => {
    expect(deriveStep(project({ status: 'error', scenes: [] }))).toBe(1);
    expect(deriveStep(project({ status: 'error', scenes: [scene()] }))).toBe(2);
  });
});

describe('isTransientStatus', () => {
  it('true for in-flight statuses, false otherwise', () => {
    expect(isTransientStatus('transcribing')).toBe(true);
    expect(isTransientStatus('segmenting')).toBe(true);
    expect(isTransientStatus('generating_images')).toBe(true);
    expect(isTransientStatus('rendering')).toBe(true);
    expect(isTransientStatus('draft')).toBe(false);
    expect(isTransientStatus('ready_to_render')).toBe(false);
    expect(isTransientStatus('done')).toBe(false);
    expect(isTransientStatus('error')).toBe(false);
  });
});

describe('allScenesDone / canRender', () => {
  it('false when empty, false with any non-done, true when all done', () => {
    expect(allScenesDone([])).toBe(false);
    expect(allScenesDone([scene({ imageStatus: 'done', imagePath: '/a.png' }), scene({ imageStatus: 'pending' })])).toBe(false);
    expect(allScenesDone([scene({ imageStatus: 'done', imagePath: '/a.png' })])).toBe(true);
  });
  it('canRender mirrors allScenesDone on the project scenes', () => {
    expect(canRender(project({ scenes: [scene({ imageStatus: 'done', imagePath: '/a.png' })] }))).toBe(true);
    expect(canRender(project({ scenes: [] }))).toBe(false);
  });
});

describe('sceneTimeLabel', () => {
  it('formats ms windows as m:ss–m:ss', () => {
    expect(sceneTimeLabel(scene({ startMs: 0, endMs: 8000 }))).toBe('0:00–0:08');
    expect(sceneTimeLabel(scene({ startMs: 65000, endMs: 72000 }))).toBe('1:05–1:12');
  });
});

describe('progressLabel', () => {
  it('maps transient statuses to human text', () => {
    expect(progressLabel('transcribing')).toMatch(/transcrib/i);
    expect(progressLabel('segmenting')).toMatch(/scene/i);
    expect(progressLabel('generating_images')).toMatch(/image/i);
    expect(progressLabel('rendering')).toMatch(/render/i);
  });
});

describe('imageCounts', () => {
  it('counts done vs total', () => {
    expect(imageCounts([scene({ imageStatus: 'done' }), scene({ imageStatus: 'pending' })])).toEqual({ done: 1, total: 2 });
  });
});

describe('isStalled', () => {
  it('true when a client-driven stage has no client driving it', () => {
    expect(isStalled(project({ status: 'generating_images' }), false)).toBe(true);
    expect(isStalled(project({ status: 'transcribing' }), false)).toBe(true);
    expect(isStalled(project({ status: 'segmenting' }), false)).toBe(true);
  });
  it('false while the client is actively driving (busy)', () => {
    expect(isStalled(project({ status: 'generating_images' }), true)).toBe(false);
  });
  it('false for rendering — it is server-driven, not client-orchestrated', () => {
    expect(isStalled(project({ status: 'rendering' }), false)).toBe(false);
  });
  it('false for stable statuses', () => {
    expect(isStalled(project({ status: 'ready_to_render' }), false)).toBe(false);
    expect(isStalled(project({ status: 'done' }), false)).toBe(false);
    expect(isStalled(project({ status: 'error' }), false)).toBe(false);
  });
});
