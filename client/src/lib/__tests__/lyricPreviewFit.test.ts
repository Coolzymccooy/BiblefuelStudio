import { describe, it, expect } from 'vitest';
import { chooseBackdropFit } from '../lyricPreviewFit';

// The same cases as chooseSceneFit's tests (server/src/lib/story/sceneFraming.test.js), for the user's own media.
describe('chooseBackdropFit', () => {
  const portrait = { width: 720, height: 1280 };
  it('shows a landscape upload in a portrait frame whole, not cropped', () => {
    expect(chooseBackdropFit({ width: 1920, height: 1080 }, portrait)).toBe('contain');
  });
  it("fills the frame with a picture already the frame's shape", () => {
    expect(chooseBackdropFit({ width: 1080, height: 1920 }, portrait)).toBe('cover');
    expect(chooseBackdropFit({ width: 768, height: 1344 }, portrait)).toBe('cover');
  });
  it('shows a portrait picture in a landscape frame whole', () => {
    expect(chooseBackdropFit({ width: 720, height: 1280 }, { width: 1280, height: 720 })).toBe('contain');
  });
  it('shows a 4:5 photo in a 9:16 frame whole (a crop would lose too much)', () => {
    expect(chooseBackdropFit({ width: 1080, height: 1350 }, portrait)).toBe('contain');
  });
  it('treats the preview frame and the render frame alike (same shape)', () => {
    expect(chooseBackdropFit({ width: 1920, height: 1080 }, { width: 360, height: 640 })).toBe('contain');
    expect(chooseBackdropFit({ width: 1080, height: 1920 }, { width: 360, height: 640 })).toBe('cover');
  });
  it('keeps the fill when the size is unknown', () => {
    expect(chooseBackdropFit(null, portrait)).toBe('cover');
    expect(chooseBackdropFit({ width: 0, height: 0 }, portrait)).toBe('cover');
  });
});
