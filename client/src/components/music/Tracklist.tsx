import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useState } from 'react';
import { restrictToVerticalAxisModifier } from './dragModifiers';
import { Pager } from '../ui/Pager';
import { pageWindow, storedPageSize, storePageSize } from '../../lib/pagination';
import { TrackRow, type TrackRowData } from './TrackRow';
import { trackGridCols, type TrackListVariant } from './trackGrid';
import type { RowMenuItem } from './RowMenu';

interface TracklistProps {
  rows: TrackRowData[];
  variant: TrackListVariant;
  /** Fixed order: rows can be dragged, and the numbers are the playing order. */
  reorderable: boolean;
  onReorder: (from: number, to: number) => void;
  playingKey: string | null;
  onPreview: (index: number) => void;
  onLicenceClick: (index: number) => void;
  menuFor: (index: number) => RowMenuItem[];
}

/**
 * The chosen tracks as a list. Dragging works with a mouse, a finger (after a
 * short move, so a scroll isn't a drag) and the keyboard (space, arrows,
 * space) — dnd-kit's sensors.
 *
 * Paged, so a long soundtrack doesn't run down the screen: 10 a page by
 * default, up to 100. Numbers and actions keep each row's place in the whole
 * list; dragging moves within a page, and "Move up/down" crosses pages.
 */
export function Tracklist({ rows, variant, reorderable, onReorder, playingKey, onPreview, onLicenceClick, menuFor }: TracklistProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(storedPageSize);
  const w = pageWindow(rows.length, page, pageSize);
  const visible = rows.slice(w.start, w.end);
  const changeSize = (size: number) => {
    // Keep the first row on screen in view at the new size.
    setPage(Math.floor(w.start / size) + 1);
    setPageSize(size);
    storePageSize(size);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = rows.findIndex((r) => r.key === active.id);
    const to = rows.findIndex((r) => r.key === over.id);
    if (from >= 0 && to >= 0) onReorder(from, to);
  };

  return (
    <div>
      {variant === 'full' && (
        <div className={`grid ${trackGridCols('full')} gap-2 border-b border-[rgba(216,184,120,0.18)] px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-bf-muted`}>
          <span />
          <span className="hidden text-right md:block">#</span>
          <span />
          <span>Title</span>
          <span className="hidden md:block">Credit</span>
          <span>Licence</span>
          <span className="text-right">Time</span>
          <span />
        </div>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} modifiers={[restrictToVerticalAxisModifier]}>
        <SortableContext items={visible.map((r) => r.key)} strategy={verticalListSortingStrategy}>
          <ol aria-label="Chosen tracks" className="space-y-0.5" start={w.start + 1}>
            {visible.map((row, k) => {
              const i = w.start + k;
              return (
                <TrackRow
                  key={row.key}
                  row={row}
                  index={i}
                  variant={variant}
                  draggable={reorderable}
                  playing={playingKey === row.key}
                  onPreview={() => onPreview(i)}
                  onLicenceClick={() => onLicenceClick(i)}
                  menu={menuFor(i)}
                />
              );
            })}
          </ol>
        </SortableContext>
      </DndContext>
      {rows.length > 0 && (
        <Pager label="tracks" total={rows.length} window={w} pageSize={pageSize} onPage={setPage} onPageSize={changeSize} />
      )}
    </div>
  );
}
