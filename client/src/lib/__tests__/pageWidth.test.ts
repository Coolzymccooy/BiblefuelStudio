import { describe, it, expect } from 'vitest';
import { pageWidthClass, DEFAULT_PAGE_WIDTH } from '../pageWidth';

describe('pageWidthClass', () => {
  it('gives the timeline a near-full-width editing surface', () => {
    expect(pageWidthClass('/app/timeline')).toBe('max-w-[1600px]');
  });

  it('gives two-pane screens a wider column than the default', () => {
    expect(pageWidthClass('/app/voice-audio')).toBe('max-w-6xl');
    expect(pageWidthClass('/app/story')).toBe('max-w-6xl');
  });

  it('keeps reading and form screens narrow', () => {
    expect(pageWidthClass('/app/scripts')).toBe(DEFAULT_PAGE_WIDTH);
    expect(pageWidthClass('/app/settings')).toBe(DEFAULT_PAGE_WIDTH);
    expect(pageWidthClass('/app')).toBe(DEFAULT_PAGE_WIDTH);
  });

  it('matches nested routes under a mapped prefix', () => {
    expect(pageWidthClass('/app/timeline/anything')).toBe('max-w-[1600px]');
  });

  it('prefers the longest matching prefix', () => {
    // /app/story is mapped; a hypothetical shorter prefix must not win.
    expect(pageWidthClass('/app/story/123')).toBe('max-w-6xl');
  });

  it('handles empty and nullish input without throwing', () => {
    expect(pageWidthClass('')).toBe(DEFAULT_PAGE_WIDTH);
    expect(pageWidthClass(undefined as unknown as string)).toBe(DEFAULT_PAGE_WIDTH);
  });
});
