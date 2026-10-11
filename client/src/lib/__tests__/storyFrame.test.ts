import { describe, it, expect } from 'vitest';
import { frameBoxClass, frameThumbWidthClass, sceneThumbFit } from '../storyFrame';

describe('storyFrame', () => {
  it('draws each output frame in its own shape', () => {
    expect(frameBoxClass('portrait')).toBe('aspect-[9/16]');
    expect(frameBoxClass('landscape')).toBe('aspect-video');
    expect(frameBoxClass('square')).toBe('aspect-square');
  });
  it('a project without a frame is portrait', () => {
    expect(frameBoxClass(undefined)).toBe('aspect-[9/16]');
  });
  it('wider frames get wider thumbnails so they stay legible', () => {
    expect(frameThumbWidthClass('portrait')).toBe('w-20');
    expect(frameThumbWidthClass('square')).toBe('w-24');
    expect(frameThumbWidthClass('landscape')).toBe('w-32');
  });

  describe('sceneThumbFit mirrors the render', () => {
    it('a landscape upload in a portrait story is shown whole', () => {
      expect(sceneThumbFit({ width: 1920, height: 1080, aspect: 'portrait', generated: false })).toBe('contain');
    });
    it("a picture already the frame's shape fills it", () => {
      expect(sceneThumbFit({ width: 1080, height: 1920, aspect: 'portrait', generated: false })).toBe('cover');
    });
    it('a generated square in a portrait story is cropped to fill, as the render does', () => {
      expect(sceneThumbFit({ width: 1024, height: 1024, aspect: 'portrait', generated: true })).toBe('cover');
    });
    it('a generated portrait image in a landscape story is shown whole', () => {
      expect(sceneThumbFit({ width: 720, height: 1280, aspect: 'landscape', generated: true })).toBe('contain');
    });
    it('before the picture loads: generated fills, your own is shown whole', () => {
      expect(sceneThumbFit({ aspect: 'portrait', generated: true })).toBe('cover');
      expect(sceneThumbFit({ aspect: 'portrait', generated: false })).toBe('contain');
    });
  });
});
