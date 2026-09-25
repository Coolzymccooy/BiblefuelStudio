import { describe, it, expect, beforeEach } from 'vitest';
import { pageWindow, pageOf, storedPageSize, storePageSize, DEFAULT_PAGE_SIZE } from '../pagination';

describe('pageWindow', () => {
  it('slices a list into pages', () => {
    expect(pageWindow(30, 1, 10)).toEqual({ page: 1, pageCount: 3, start: 0, end: 10 });
    expect(pageWindow(30, 3, 10)).toEqual({ page: 3, pageCount: 3, start: 20, end: 30 });
    expect(pageWindow(25, 3, 10)).toEqual({ page: 3, pageCount: 3, start: 20, end: 25 });
  });

  it('clamps a page past the end (a list that shrank) and before the start', () => {
    expect(pageWindow(12, 5, 10)).toEqual({ page: 2, pageCount: 2, start: 10, end: 12 });
    expect(pageWindow(12, 0, 10).page).toBe(1);
  });

  it('an empty list is one empty page', () => {
    expect(pageWindow(0, 1, 10)).toEqual({ page: 1, pageCount: 1, start: 0, end: 0 });
  });
});

describe('pageOf', () => {
  it('finds the page an item sits on', () => {
    expect(pageOf(0, 10)).toBe(1);
    expect(pageOf(9, 10)).toBe(1);
    expect(pageOf(10, 10)).toBe(2);
  });
});

describe('stored page size', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to 10 and remembers an allowed choice', () => {
    expect(storedPageSize()).toBe(DEFAULT_PAGE_SIZE);
    storePageSize(50);
    expect(storedPageSize()).toBe(50);
  });

  it('ignores a size that is not offered', () => {
    localStorage.setItem('bf_music_page_size_v1', '7');
    expect(storedPageSize()).toBe(10);
  });
});
