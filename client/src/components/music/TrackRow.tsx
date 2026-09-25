import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Play, Square } from 'lucide-react';
import { formatDuration } from '../../lib/soundtrack';
import { RowMenu, type RowMenuItem } from './RowMenu';

export type RowLicence = 'cleared' | 'missing' | null;

export interface TrackRowData {
  /** Unique within the list (a track can appear twice). */
  key: string;
  label: string;
  /** Second line: "vocals removed", or the credit in the compact layout. */
  subtitle?: string;
  credit?: string;
  durationSec: number | null;
  licence: RowLicence;
  colour: string;
  canPlay: boolean;
}

export type TrackListVariant = 'full' | 'compact';

interface TrackRowProps {
  row: TrackRowData;
  index: number;
  variant: TrackListVariant;
  draggable: boolean;
  /** Shuffle mode: the position is not the playing order. */
  dimNumber: boolean;
  playing: boolean;
  onPreview: () => void;
  onLicenceClick?: () => void;
  menu: RowMenuItem[];
}

const FULL_COLS = 'grid-cols-[16px_32px_minmax(0,1fr)_auto_44px_28px] md:grid-cols-[16px_22px_36px_minmax(0,1fr)_minmax(0,200px)_88px_56px_28px]';
const COMPACT_COLS = 'grid-cols-[14px_30px_minmax(0,1fr)_auto_38px_26px]';

export const trackGridCols = (variant: TrackListVariant) => (variant === 'full' ? FULL_COLS : COMPACT_COLS);

function LicenceBadge({ licence, variant, onClick }: { licence: RowLicence; variant: TrackListVariant; onClick?: () => void }) {
  if (licence === 'missing') {
    return (
      <button
        type="button"
        onClick={onClick}
        title="This track's licence is not recorded. Click to mark it cleared. On a long music-led video a Content ID claim takes the revenue for the whole video."
        className="justify-self-start whitespace-nowrap rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 hover:bg-amber-500/20"
      >
        licence?
      </button>
    );
  }
  if (licence === 'cleared' && variant === 'full') {
    return <span className="justify-self-start whitespace-nowrap rounded-full border border-bf-success/40 px-2 py-0.5 text-[10px] text-bf-success">cleared</span>;
  }
  return <span />;
}

/**
 * One track in a music list. The coloured tile previews it; the grip drags
 * it (mouse, touch or keyboard) when the list keeps a fixed order.
 */
export function TrackRow({ row, index, variant, draggable, dimNumber, playing, onPreview, onLicenceClick, menu }: TrackRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.key, disabled: !draggable });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const full = variant === 'full';
  const tile = full ? 'h-9 w-9 text-sm' : 'h-[30px] w-[30px] text-[11px]';

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`grid ${trackGridCols(variant)} items-center gap-2 rounded-lg px-2 ${full ? 'py-2' : 'py-1.5'} transition-colors hover:bg-bf-card2 ${isDragging ? 'z-10 bg-bf-card2 shadow-lg' : ''}`}
    >
      {draggable ? (
        <button
          type="button"
          aria-label={`Drag ${row.label}`}
          className="cursor-grab touch-none text-bf-faint hover:text-bf-cream active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={14} />
        </button>
      ) : <span />}

      {full && (
        <span className={`hidden text-right font-mono text-[11px] md:block ${dimNumber ? 'text-bf-faint/50' : 'text-bf-faint'}`}>{index + 1}</span>
      )}

      <button
        type="button"
        onClick={onPreview}
        disabled={!row.canPlay}
        aria-label={playing ? `Stop ${row.label}` : `Preview ${row.label}`}
        title={row.canPlay ? (playing ? 'Stop' : 'Preview') : 'No preview for this track'}
        className={`group relative flex ${tile} shrink-0 items-center justify-center rounded-md font-mono text-white shadow-sm disabled:cursor-default`}
        style={{ backgroundColor: row.colour }}
      >
        <span className={row.canPlay ? 'group-hover:hidden' : ''}>{playing ? <Square size={12} /> : (full ? '♪' : index + 1)}</span>
        {row.canPlay && !playing && <Play size={12} className="hidden group-hover:block" />}
      </button>

      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold text-bf-cream" title={row.label}>{row.label}</div>
        {(row.subtitle || (!full && row.credit)) && (
          <div className="truncate text-[11px] text-bf-muted">{row.subtitle || row.credit}</div>
        )}
      </div>

      {full && <div className="hidden truncate text-[11.5px] text-bf-muted md:block" title={row.credit}>{row.credit || '—'}</div>}

      <LicenceBadge licence={row.licence} variant={variant} onClick={onLicenceClick} />

      <span className="text-right font-mono text-[11px] text-bf-sub">{formatDuration(row.durationSec)}</span>

      <RowMenu label={row.label} items={menu} />
    </li>
  );
}
