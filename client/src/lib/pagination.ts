/**
 * Pages for a list that keeps growing (the music library, a soundtrack of
 * dozens of tracks). Pure, so the pager and the lists share one answer.
 */

export const PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 10;
const STORAGE_KEY = 'bf_music_page_size_v1';

export interface PageWindow {
  /** 1-based, clamped to what exists (a shrinking list never strands you). */
  page: number;
  pageCount: number;
  /** Slice bounds into the full list. */
  start: number;
  end: number;
}

export function pageWindow(total: number, page: number, size: number): PageWindow {
  const perPage = Math.max(1, Math.floor(size) || DEFAULT_PAGE_SIZE);
  const count = Math.max(0, Math.floor(total) || 0);
  const pageCount = Math.max(1, Math.ceil(count / perPage));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (current - 1) * perPage;
  return { page: current, pageCount, start, end: Math.min(count, start + perPage) };
}

/** The page an item at `index` is on. */
export function pageOf(index: number, size: number): number {
  return Math.floor(Math.max(0, index) / Math.max(1, size)) + 1;
}

/** The operator's page size, remembered on this device; the default when unset or unreadable. */
export function storedPageSize(): number {
  try {
    const n = Number(localStorage.getItem(STORAGE_KEY));
    return (PAGE_SIZES as readonly number[]).includes(n) ? n : DEFAULT_PAGE_SIZE;
  } catch {
    return DEFAULT_PAGE_SIZE;
  }
}

export function storePageSize(size: number): void {
  try { localStorage.setItem(STORAGE_KEY, String(size)); } catch { /* private mode: this visit only */ }
}
