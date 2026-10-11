import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pairFilesWithScenes, sceneNumberIn, putOwnImage } from '../storyImages';
import type { StoryScene } from '../storyTypes';

const uploadMedia = vi.fn();
const setSceneImage = vi.fn();
vi.mock('../mediaUpload', () => ({ uploadMedia: (...a: unknown[]) => uploadMedia(...a) }));
vi.mock('../storyApi', () => ({ storyApi: { setSceneImage: (...a: unknown[]) => setSceneImage(...a) } }));

describe('putOwnImage', () => {
  beforeEach(() => {
    uploadMedia.mockReset();
    setSceneImage.mockReset().mockResolvedValue({ projectId: 'p1' });
  });

  it('puts an uploaded photo on the scene', async () => {
    uploadMedia.mockResolvedValue({ ok: true, file: '/o/bg-image-1.jpg', kind: 'image' });
    const photo = new File(['x'], 'Scene 1.jpg', { type: 'image/jpeg' });
    await putOwnImage('p1', 's1', photo);
    expect(uploadMedia).toHaveBeenCalledWith(photo, 'Scene 1.jpg', 'background');
    expect(setSceneImage).toHaveBeenCalledWith('p1', 's1', { uploadPath: '/o/bg-image-1.jpg' });
  });

  it('puts an uploaded video clip on the scene too, instead of refusing it', async () => {
    uploadMedia.mockResolvedValue({ ok: true, file: '/o/bg-video-1.mp4', kind: 'video' });
    const clip = new File(['x'], 'pixabay.mp4', { type: 'video/mp4' });
    await expect(putOwnImage('p1', 's2', clip)).resolves.toEqual({ projectId: 'p1' });
    expect(setSceneImage).toHaveBeenCalledWith('p1', 's2', { uploadPath: '/o/bg-video-1.mp4' });
  });
});

function scene(i: number, done = false): StoryScene {
  return {
    id: `s${i + 1}`, text: '', startMs: 0, endMs: 1, imagePrompt: '', imagePath: done ? '/x.png' : null,
    imageStatus: done ? 'done' : 'error', promptEditedByUser: false,
  };
}
const file = (name: string) => ({ name });

describe('sceneNumberIn', () => {
  it('reads the scene number the brief asked the AI to label images with', () => {
    expect(sceneNumberIn('Scene 3.png')).toBe(3);
    expect(sceneNumberIn('scene_07.jpg')).toBe(7);
    expect(sceneNumberIn('Scene-12 final.webp')).toBe(12);
    expect(sceneNumberIn('ChatGPT Image Oct 9, 2026, 03_24_11 PM.png')).toBeNull();
    expect(sceneNumberIn('IMG_4412.JPG')).toBeNull();
    expect(sceneNumberIn('obscene 2.png')).toBeNull();
    expect(sceneNumberIn('img_scene4.png')).toBe(4);
  });
});

describe('pairFilesWithScenes', () => {
  const scenes = [scene(0, true), scene(1), scene(2), scene(3, true), scene(4)];

  it('fills the scenes still needing a picture, in order, when names carry no scene number', () => {
    const { pairs, extra } = pairFilesWithScenes([file('b.png'), file('a.png'), file('c.png')], scenes);
    expect(pairs.map((p) => [p.file.name, p.scene.id])).toEqual([['a.png', 's2'], ['b.png', 's3'], ['c.png', 's5']]);
    expect(extra).toEqual([]);
  });

  it('sorts names the way people number them (2 before 10)', () => {
    const { pairs } = pairFilesWithScenes([file('img10.png'), file('img2.png')], scenes);
    expect(pairs.map((p) => p.file.name)).toEqual(['img2.png', 'img10.png']);
  });

  it('puts "Scene N" images on scene N, even out of order', () => {
    const { pairs, extra } = pairFilesWithScenes([file('Scene 5.png'), file('Scene 2.png')], scenes);
    expect(pairs.map((p) => [p.file.name, p.scene.id])).toEqual([['Scene 2.png', 's2'], ['Scene 5.png', 's5']]);
    expect(extra).toEqual([]);
  });

  it('a numbered image can replace a scene that already has one, since you named it', () => {
    const { pairs } = pairFilesWithScenes([file('Scene 1.png')], scenes);
    expect(pairs.map((p) => p.scene.id)).toEqual(['s1']);
  });

  it('numbered images claim their scenes first; the rest fill the gaps in order', () => {
    const { pairs } = pairFilesWithScenes([file('x.png'), file('Scene 3.png')], scenes);
    // Returned in scene order, the order they are uploaded in.
    expect(pairs.map((p) => [p.file.name, p.scene.id])).toEqual([['x.png', 's2'], ['Scene 3.png', 's3']]);
  });

  it('keeps what does not fit: more images than gaps, or a number with no such scene', () => {
    const { pairs, extra } = pairFilesWithScenes(
      [file('1.png'), file('2.png'), file('3.png'), file('4.png'), file('Scene 99.png')], scenes,
    );
    expect(pairs).toHaveLength(3);
    expect(extra.map((f) => f.name)).toEqual(['Scene 99.png', '4.png']);
  });
});
