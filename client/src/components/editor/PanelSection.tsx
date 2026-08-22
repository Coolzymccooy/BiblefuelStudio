import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * A collapsible section inside an editor panel.
 *
 * A panel holding one control — the Music tool is a single dropdown — leaves
 * most of a 296px column empty while related controls sit behind other rail
 * icons. Sections let one panel carry several groups, each collapsed until
 * wanted, so the column is used rather than padded.
 *
 * Collapsed by default is deliberate for secondary groups: an expanded stack
 * recreates the scrolling wall this layout exists to replace.
 */

export interface PanelSectionProps {
  title: string;
  children: ReactNode;
  /** Open on first render. Use for the section the tool is named after. */
  defaultOpen?: boolean;
  /** Count shown beside the title — clips, items, whatever the section holds. */
  count?: number;
  /** One-line summary shown when collapsed, so the value is legible closed. */
  summary?: string;
}

export function PanelSection({
  title,
  children,
  defaultOpen = false,
  count,
  summary,
}: PanelSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-editor-line last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 py-2.5 text-left"
      >
        <ChevronDown
          size={13}
          className={`shrink-0 text-editor-faint transition-transform ${open ? '' : '-rotate-90'}`}
        />
        <span className="text-[11px] font-semibold uppercase tracking-[.08em] text-editor-dim">
          {title}
        </span>
        {typeof count === 'number' && count > 0 && (
          <span className="text-[10px] text-editor-faint">{count}</span>
        )}
        {/* The summary is what makes a collapsed section useful rather than
            merely tidy — you can read the current value without opening it. */}
        {!open && summary && (
          <span className="ml-auto min-w-0 truncate text-[10px] text-editor-faint">{summary}</span>
        )}
      </button>

      {open && <div className="pb-3">{children}</div>}
    </div>
  );
}
