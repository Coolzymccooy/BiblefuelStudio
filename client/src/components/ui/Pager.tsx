import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PAGE_SIZES, type PageWindow } from '../../lib/pagination';

interface PagerProps {
  /** What is being paged, for screen readers ("tracks", "library"). */
  label: string;
  total: number;
  window: PageWindow;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}

/**
 * "Showing 11–20 of 30 · Show [10] per page · ‹ Previous  Page 2 of 3  Next ›".
 * Always shown, even for one page, so the controls are where the operator
 * expects them however long the list is; the buttons just go quiet.
 */
export function Pager({ label, total, window: w, pageSize, onPage, onPageSize }: PagerProps) {
  const btn = 'inline-flex items-center gap-0.5 rounded-md border border-[rgba(216,184,120,0.3)] px-2 py-1 text-xs text-bf-cream transition hover:border-bf-gold disabled:cursor-not-allowed disabled:border-[rgba(216,184,120,0.12)] disabled:text-bf-muted';
  return (
    <nav aria-label={`Pages of ${label}`} className="flex flex-wrap items-center justify-between gap-2 px-2 pt-2 text-xs text-bf-muted">
      <span aria-live="polite">
        {total === 0 ? 'Nothing yet' : `Showing ${w.start + 1}–${w.end} of ${total}`}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1">
          Show
          <select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            aria-label={`${label} per page`}
            className="rounded-md border border-[rgba(216,184,120,0.3)] bg-bf-card px-1 py-0.5 text-xs text-bf-cream"
          >
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          per page
        </label>
        <button type="button" onClick={() => onPage(w.page - 1)} disabled={w.page <= 1} className={btn} aria-label="Previous page">
          <ChevronLeft size={12} /> Previous
        </button>
        <span className="tabular-nums text-bf-sub">Page {w.page} of {w.pageCount}</span>
        <button type="button" onClick={() => onPage(w.page + 1)} disabled={w.page >= w.pageCount} className={btn} aria-label="Next page">
          Next <ChevronRight size={12} />
        </button>
      </div>
    </nav>
  );
}
