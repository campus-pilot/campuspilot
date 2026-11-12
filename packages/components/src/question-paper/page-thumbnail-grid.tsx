'use client';

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@campuspilot/ui/components/button';
import { FileImage, GripVertical, Trash2 } from 'lucide-react';
import { formatPageSize, movePageId, PAGE_DRAG_INSTRUCTIONS, pageDragAnnouncements } from './question-paper-model';

export type PageThumbnailView = {
  id: string;
  position: number;
  originalName: string;
  byteSize: number;
  /** `unsupported`: the server could not decode the photo, so there is no thumbnail. */
  derivativeStatus: 'ready' | 'unsupported';
};

function PageTile({
  page,
  src,
  disabled,
  onDelete,
}: {
  page: PageThumbnailView;
  src: string;
  disabled: boolean;
  onDelete: (pageId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: page.id,
    disabled,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
      className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-2"
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-xs font-medium">Page {page.position}</span>
        <div className="flex items-center">
          {/* The handle alone starts a drag (`touch-none`), so scrolling the grid with a finger keeps working. */}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="cursor-grab touch-none active:cursor-grabbing"
            disabled={disabled}
            aria-label={`Move page ${page.position}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-label={`Delete page ${page.position}`}
            onClick={() => onDelete(page.id)}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      </div>
      <div className="grid aspect-[3/4] place-items-center overflow-hidden rounded-md border bg-muted/40">
        {page.derivativeStatus === 'ready' ? (
          <img
            src={src}
            alt={`Page ${page.position}: ${page.originalName}`}
            loading="lazy"
            draggable={false}
            className="size-full object-contain"
          />
        ) : (
          <div className="flex flex-col items-center gap-1 px-2 text-center text-xs text-muted-foreground">
            <FileImage className="size-6" aria-hidden />
            Preview not available
          </div>
        )}
      </div>
      <p className="truncate text-xs text-muted-foreground" title={page.originalName}>
        {page.originalName} · {formatPageSize(page.byteSize)}
      </p>
    </li>
  );
}

/**
 * The uploaded photos in reading order. Drag a tile by its handle (or focus the
 * handle, press Space, move with the arrow keys and press Space again) to
 * reorder; the new order goes to `onReorder`. The caller owns persistence, the
 * optimistic order and conflicts: this grid only shows what `pages` says.
 */
export function PageThumbnailGrid({
  pages,
  thumbUrl,
  disabled = false,
  onReorder,
  onDelete,
}: {
  pages: readonly PageThumbnailView[];
  thumbUrl: (pageId: string) => string;
  disabled?: boolean;
  onReorder: (pageIds: string[]) => void;
  onDelete: (pageId: string) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = pages.map((page) => page.id);
  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over) return;
    const next = movePageId(ids, String(active.id), String(over.id));
    if (next) onReorder(next);
  }
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      accessibility={{ announcements: pageDragAnnouncements(pages), screenReaderInstructions: { draggable: PAGE_DRAG_INSTRUCTIONS } }}
    >
      <SortableContext items={ids} strategy={rectSortingStrategy} disabled={disabled}>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="Uploaded pages">
          {pages.map((page) => (
            <PageTile key={page.id} page={page} src={thumbUrl(page.id)} disabled={disabled} onDelete={onDelete} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
