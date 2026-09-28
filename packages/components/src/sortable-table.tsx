'use client';

import type { CSSProperties, ReactNode } from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@campuspilot/ui/components/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@campuspilot/ui/components/table';
import { GripVertical } from 'lucide-react';

export type SortableTableColumn<TData> = {
  id: string;
  header: ReactNode;
  cell: (item: TData) => ReactNode;
  className?: string;
};

export type SortableTableProps<TData> = {
  ariaLabel: string;
  columns: readonly SortableTableColumn<TData>[];
  data: readonly TData[];
  emptyMessage: string;
  getRowId: (item: TData) => string;
  getRowLabel: (item: TData) => string;
  onReorder?: (items: TData[]) => void;
  onRowClick?: (item: TData) => void;
  reorderDisabled?: boolean;
};

function SortableRow<TData>({
  columns,
  getRowId,
  getRowLabel,
  item,
  onRowClick,
  reorderDisabled,
}: Pick<
  SortableTableProps<TData>,
  | 'columns'
  | 'getRowId'
  | 'getRowLabel'
  | 'onRowClick'
  | 'reorderDisabled'
> & { item: TData }) {
  const rowId = getRowId(item);
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: rowId, disabled: reorderDisabled });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
    position: 'relative',
    zIndex: isDragging ? 1 : undefined,
  };

  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      className={onRowClick ? 'cursor-pointer hover:bg-muted/50' : undefined}
      onClick={
        onRowClick
          ? (event) => {
              const target = event.target as HTMLElement | null;
              if (
                target?.closest(
                  'button, a, input, select, textarea, [role="button"], [role="menuitem"]',
                )
              ) {
                return;
              }
              onRowClick(item);
            }
          : undefined
      }
    >
      {reorderDisabled ? null : (
        <TableCell className="w-10 pr-0">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="cursor-grab text-muted-foreground active:cursor-grabbing"
            aria-label={`Reorder ${getRowLabel(item)}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical aria-hidden />
          </Button>
        </TableCell>
      )}
      {columns.map((column) => (
        <TableCell key={column.id} className={column.className}>
          {column.cell(item)}
        </TableCell>
      ))}
    </TableRow>
  );
}

/**
 * Renders a table-shaped sortable collection. Data ownership and persistence
 * stay with the consuming app; this component only reports the reordered array.
 */
export function SortableTable<TData>({
  ariaLabel,
  columns,
  data,
  emptyMessage,
  getRowId,
  getRowLabel,
  onReorder,
  onRowClick,
  reorderDisabled = false,
}: SortableTableProps<TData>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const canReorder = onReorder !== undefined && !reorderDisabled;
  const itemIds = data.map(getRowId);

  function handleDragEnd(event: DragEndEvent) {
    if (!onReorder || !event.over || event.active.id === event.over.id) return;
    const oldIndex = itemIds.indexOf(String(event.active.id));
    const newIndex = itemIds.indexOf(String(event.over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove([...data], oldIndex, newIndex));
  }

  const table = (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table aria-label={ariaLabel}>
        <TableHeader className="bg-muted/40">
          <TableRow>
            {canReorder ? <TableHead className="w-10" /> : null}
            {columns.map((column) => (
              <TableHead key={column.id} className={column.className}>
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length + (canReorder ? 1 : 0)}
                className="h-32 text-center text-muted-foreground"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            data.map((item) => (
              <SortableRow
                key={getRowId(item)}
                item={item}
                columns={columns}
                getRowId={getRowId}
                getRowLabel={getRowLabel}
                onRowClick={onRowClick}
                reorderDisabled={!canReorder}
              />
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <DndContext
      id={`${ariaLabel.toLowerCase().replaceAll(' ', '-')}-sortable-context`}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        {table}
      </SortableContext>
    </DndContext>
  );
}
