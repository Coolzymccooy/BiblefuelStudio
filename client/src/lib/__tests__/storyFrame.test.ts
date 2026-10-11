import { describe, it, expect } from 'vitest';
import { frameBoxClass, frameThumbWidthClass } from '../storyFrame';

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
});
