import { describe, it, expect } from 'vitest';
import { buildImageBrief, briefFileName, scenesNeedingImages } from '../storyBrief';
import type { StoryProject, StoryScene } from '../storyTypes';

function scene(i: number, over: Partial<StoryScene> = {}): StoryScene {
  return {
    id: `s${i}`, text: `Words of scene ${i + 1}`, startMs: i * 8000, endMs: i * 8000 + 8000,
    imagePrompt: `prompt for scene ${i + 1}`, imagePath: null, imageStatus: 'error', promptEditedByUser: false, ...over,
  };
}

function project(over: Partial<StoryProject> = {}): StoryProject {
  return {
    projectId: 'p1', title: 'Starting Small', style: 'heavenly-atmosphere', status: 'generating_images',
    source: { audioPath: null, durationMs: 24000 },
    transcript: { words: [{ text: 'There', startMs: 0, endMs: 300 }, { text: 'is', startMs: 300, endMs: 500 }, { text: 'hope', startMs: 500, endMs: 900 }], hash: null },
    scenes: [scene(0, { imageStatus: 'done', imagePath: '/x.png' }), scene(1), scene(2)],
    music: { path: null, volume: 0.3 }, captionPreset: 'default',
    render: { jobId: null, outputPath: null, status: null }, error: null,
    createdAt: 0, updatedAt: 0, ...over,
  };
}

describe('buildImageBrief', () => {
  it('carries everything an image AI needs, in one paste', () => {
    const brief = buildImageBrief(project({ cast: ['david_young'] }), {
      characters: [{ key: 'david_young', description: 'a young shepherd boy' }],
    });
    expect(brief).toContain('Starting Small');
    expect(brief).toContain('Portrait 9:16 (1080×1920)');
    expect(brief).toMatch(/no words, letters/i);
    expect(brief).toContain('Heavenly Atmosphere');
    expect(brief).toContain('david young: a young shepherd boy');
    expect(brief).toContain('3 scenes');
    expect(brief).toContain('There is hope');
    for (const n of [1, 2, 3]) {
      expect(brief).toContain(`Scene ${n} ·`);
      expect(brief).toContain(`Words of scene ${n}`);
      expect(brief).toContain(`prompt for scene ${n}`);
    }
  });

  it('says which scenes still need a picture, so only those get made', () => {
    const brief = buildImageBrief(project());
    expect(brief).toMatch(/Scene 1 · 0:00–0:08 · HAS IMAGE/);
    expect(brief).toMatch(/Scene 2 · 0:08–0:16 · NEEDS IMAGE/);
    expect(brief).toMatch(/only for the 2 scenes marked NEEDS IMAGE/i);
  });

  it('says so plainly when every scene already has a picture, or only one is missing', () => {
    const done = (i: number) => scene(i, { imageStatus: 'done', imagePath: '/x.png' });
    const all = buildImageBrief(project({ scenes: [done(0), done(1)] }));
    expect(all).toMatch(/every scene already has an image/i);
    expect(all).not.toMatch(/the 0 scenes/);
    expect(buildImageBrief(project({ scenes: [done(0), scene(1)] }))).toMatch(/only for the scene marked NEEDS IMAGE/);
  });

  it('asks for every scene when none has a picture yet', () => {
    const brief = buildImageBrief(project({ scenes: [scene(0), scene(1)] }));
    expect(brief).toMatch(/one image for every scene/i);
    expect(brief).not.toMatch(/HAS IMAGE/);
  });

  it('can be trimmed to the scenes still missing, keeping their numbers', () => {
    const brief = buildImageBrief(project(), { onlyMissing: true });
    expect(brief).not.toContain('Scene 1 ·');
    expect(brief).toContain('Scene 2 ·');
    expect(brief).toContain('Scene 3 ·');
    expect(brief).toContain('There is hope');
  });

  it('describes a landscape video as 16:9', () => {
    expect(buildImageBrief(project({ aspect: 'landscape' }))).toContain('Landscape 16:9 (1920×1080)');
  });

  it('falls back to the scene words when there is no word-level transcript', () => {
    const brief = buildImageBrief(project({ transcript: { words: [], hash: null } }));
    expect(brief).toContain('Words of scene 1 Words of scene 2 Words of scene 3');
  });

  it('leaves out the cast section when the story has no cast', () => {
    expect(buildImageBrief(project())).not.toMatch(/^CAST/m);
  });
});

describe('scenesNeedingImages', () => {
  it('lists the scenes without a finished picture, in order', () => {
    const p = project({ scenes: [scene(0), scene(1, { imageStatus: 'done', imagePath: '/y.png' }), scene(2, { imageStatus: 'pending' })] });
    expect(scenesNeedingImages(p).map((s) => s.id)).toEqual(['s0', 's2']);
  });
});

describe('briefFileName', () => {
  it('is a safe file name from the title', () => {
    expect(briefFileName(project({ title: 'VID-2026/1007: "Wa"' }))).toBe('vid-2026-1007-wa-image-brief.txt');
    expect(briefFileName(project({ title: '' }))).toBe('story-image-brief.txt');
  });
});
