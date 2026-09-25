import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToVerticalAxisModifier } from './dragModifiers';
import { TrackRow, trackGridCols, type TrackListVariant, type TrackRowData } from './TrackRow';
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
 */
export function Tracklist({ rows, variant, reorderable, onReorder, playingKey, onPreview, onLicenceClick, menuFor }: TracklistProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = rows.findIndex((r) => r.key === active.id);
    const to = rows.findIndex((r) => r.key === over.id);
    if (from >= 0 && to >= 0) onReorder(from, to);
  };

  return (
    <div>
      {variant === 'full' && (
        <div className={`grid ${trackGridCols('full')} gap-2 border-b border-[rgba(216,184,120,0.18)] px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-bf-faint`}>
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
        <SortableContext items={rows.map((r) => r.key)} strategy={verticalListSortingStrategy}>
          <ol aria-label="Chosen tracks" className="space-y-0.5">
            {rows.map((row, i) => (
              <TrackRow
                key={row.key}
                row={row}
                index={i}
                variant={variant}
                draggable={reorderable}
                dimNumber={!reorderable}
                playing={playingKey === row.key}
                onPreview={() => onPreview(i)}
                onLicenceClick={() => onLicenceClick(i)}
                menu={menuFor(i)}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
    </div>
  );
}
