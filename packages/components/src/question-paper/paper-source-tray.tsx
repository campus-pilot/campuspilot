'use client';

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@campuspilot/ui/components/button';
import { Spinner } from '@campuspilot/ui/components/spinner';
import { cn } from '@campuspilot/ui/lib/utils';
import { CircleAlert, FileImage, Plus, X, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { movePageId, PAGE_DRAG_INSTRUCTIONS, pageDragAnnouncements } from './question-paper-model';

/** One stored photo of the paper, as the tray shows it. */
export type PageThumbnailView = {
  id: string;
  position: number;
  originalName: string;
  byteSize: number;
  /** `unsupported`: the server could not decode the photo, so there is no thumbnail. */
  derivativeStatus: 'ready' | 'unsupported';
};

/** One photo on its way to the server. */
export type UploadQueueItem = {
  id: string;
  name: string;
  /** A local preview, shown at once. Absent for a HEIC original the browser cannot draw. */
  previewUrl?: string;
  status: 'converting' | 'uploading' | 'error';
  error?: string;
};

/** A page-shaped tile: every thing in the tray (a photo, one on its way, the add tile) has this outline. */
const TILE = 'relative block aspect-[3/4] w-full overflow-hidden rounded-lg border sm:w-24';

/**
 * The small round remove button on a tile's corner, half outside it so it
 * does not cover the page; it shows on hover or keyboard focus. `hideOnTouch`
 * drops it where there is no hover: on a phone four always-visible marks sit
 * on the handwriting and under the finger that drags, so a stored page is
 * removed from the page viewer there instead.
 */
function TileRemove({ label, disabled, hideOnTouch = false, onClick }: { label: string; disabled?: boolean; hideOnTouch?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'absolute -end-1.5 -top-1.5 z-10 grid size-5 place-items-center rounded-full border bg-background text-muted-foreground opacity-0 shadow-xs transition-opacity after:absolute after:-inset-2 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/tile:opacity-100 disabled:hidden',
        hideOnTouch ? '[@media(hover:none)]:hidden' : '[@media(hover:none)]:opacity-100',
      )}
    >
      <X className="size-3" aria-hidden />
    </button>
  );
}

/** The page number in a tile's corner. It sits on a photograph, not on the theme's surface, so it is the same dark chip in both themes. */
function TileNumber({ children }: { children: number }) {
  return (
    <span className="absolute bottom-1 start-1 rounded bg-black/70 px-1.5 text-[0.6875rem] font-medium tabular-nums leading-4 text-white" aria-hidden>
      {children}
    </span>
  );
}

/**
 * One stored photo. Pressing the tile opens the page large enough to read;
 * dragging it reorders (a mouse drags after a few pixels, a finger after a
 * short press, so the page still scrolls under it; on the keyboard Space
 * picks the page up and the arrow keys move it, while Enter opens it). The
 * remove button is a sibling, not a child, so it is a control of its own.
 */
function PageTile({
  page,
  src,
  disabled,
  onOpen,
  onDelete,
}: {
  page: PageThumbnailView;
  src: string;
  disabled: boolean;
  onOpen: (pageId: string) => void;
  onDelete: (pageId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id, disabled });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn('group/tile relative', isDragging && 'z-20 opacity-70')}>
      <button
        type="button"
        aria-label={`Page ${page.position}: ${page.originalName}. Open to check it.`}
        className={cn(TILE, 'bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', disabled ? 'cursor-pointer' : 'cursor-grab touch-manipulation active:cursor-grabbing')}
        onClick={() => onOpen(page.id)}
        {...attributes}
        {...listeners}
      >
        {page.derivativeStatus === 'ready' ? (
          <img src={src} alt="" loading="lazy" draggable={false} className="size-full object-cover" />
        ) : (
          <FileImage className="absolute inset-0 m-auto size-5 text-muted-foreground" aria-hidden />
        )}
        <TileNumber>{page.position}</TileNumber>
      </button>
      <TileRemove label={`Remove page ${page.position}`} disabled={disabled} hideOnTouch onClick={() => onDelete(page.id)} />
    </li>
  );
}

/** A photo on its way to the server, where it will stand in the row: its local preview, dimmed, with its progress or its failure. */
function UploadTile({ item, onDismiss }: { item: UploadQueueItem; onDismiss: (id: string) => void }) {
  const failed = item.status === 'error';
  return (
    <li className="group/tile relative">
      <div
        role={failed ? 'img' : 'status'}
        aria-label={failed ? `${item.name} was not added` : `Adding ${item.name}`}
        className={cn(TILE, 'bg-muted', failed && 'border-destructive/60')}
      >
        {item.previewUrl ? <img src={item.previewUrl} alt="" className="size-full object-cover opacity-50" /> : null}
        <span className="absolute inset-0 grid place-items-center">
          {failed ? <CircleAlert className="size-5 text-destructive" aria-hidden /> : <Spinner className="size-4" />}
        </span>
      </div>
      {failed ? <TileRemove label={`Dismiss ${item.name}`} onClick={() => onDismiss(item.id)} /> : null}
    </li>
  );
}

/**
 * How many pages there are and what can be done with them, the things the
 * tiles cannot show by themselves: a page opens when pressed (on a phone that
 * is also where it is removed, the tiles carry no remove mark there), and
 * with more than one their order can be changed.
 */
function TrayCaption({ pageCount, canReorder }: { pageCount: number; canReorder: boolean }) {
  if (pageCount === 0) return null;
  const count = pageCount === 1 ? '1 page' : `${pageCount} pages`;
  const reorder = pageCount > 1 && canReorder;
  return (
    <p className="text-xs text-muted-foreground">
      <span className="[@media(hover:none)]:hidden">
        {count} · Click a page to check it{reorder ? ', drag to reorder' : ''}
      </span>
      <span className="hidden [@media(hover:none)]:inline">
        {count} · Tap a page to check or remove it{reorder ? '. Hold and drag to reorder' : ''}
      </span>
    </p>
  );
}

/**
 * Another way to bring the paper in (the camera, an earlier paper). The tray
 * draws it where it belongs: a button beside the words of an empty tray; once
 * there are pages, a dashed tile after the add tile from `sm` up and a button
 * beside "Add pages" on a phone.
 */
export type PaperSourceWay = {
  key: string;
  icon: LucideIcon;
  label: string;
  disabled?: boolean;
  /**
   * The kind of pointer this way is for, when it is for one only: a phone
   * takes a photo with its own camera (`coarse`), a computer with a webcam
   * dialog (`fine`). The tray then shows it only on such a device. It is a
   * fact of the way, kept apart from where the tray draws it (a tile or a
   * button, by screen width), so the two never override each other.
   */
  pointer?: 'fine' | 'coarse';
  onClick: () => void;
};

/** Shows a way's button only on the pointer it is for. */
const WAY_BUTTON_POINTER = { fine: '[@media(pointer:coarse)]:hidden', coarse: 'hidden [@media(pointer:coarse)]:inline-flex' } as const;
/** Shows a way's tile only from `sm` up, and there only on the pointer it is for. */
const WAY_TILE_VISIBILITY = {
  any: 'hidden sm:block',
  fine: 'hidden sm:block sm:[@media(pointer:coarse)]:hidden',
  coarse: 'hidden sm:[@media(pointer:coarse)]:block',
} as const;

/** A way in as an outlined button (the empty tray, and the phone's row of controls). */
function WayButton({ way, className }: { way: PaperSourceWay; className?: string }) {
  return (
    <Button type="button" variant="outline" disabled={way.disabled} className={cn(className, way.pointer ? WAY_BUTTON_POINTER[way.pointer] : undefined)} onClick={way.onClick}>
      <way.icon aria-hidden />
      {way.label}
    </Button>
  );
}

/** A dashed tile that adds more: the same shape as a page, with an icon and a word that says what it does. */
function AddTileFace({ icon: Icon = Plus, label, className }: { icon?: LucideIcon; label: string; className?: string }) {
  return (
    <span className={cn(TILE, 'flex flex-col items-center justify-center gap-1.5 border-dashed border-foreground/30 text-muted-foreground transition-colors', className)}>
      <Icon className="size-5" aria-hidden />
      <span className="px-1 text-center text-[0.6875rem] font-medium leading-tight">{label}</span>
    </span>
  );
}

/**
 * The paper's source material as a row of page-shaped tiles that ends in an
 * add tile. With nothing in it, the add tile stands alone beside two short
 * lines that say what belongs here; once a photo is added the lines go and
 * the add tile follows the last page, so where the next photo will land is
 * always the dashed tile. Photos on their way show in the row at once.
 *
 * The caller owns the files, the order's persistence and every message; this
 * only draws what it is given. `onAdd` opens the caller's file picker.
 */
export function PaperSourceTray({
  pages,
  uploads,
  thumbUrl,
  canAdd,
  disabled = false,
  emptyTitle,
  emptyHint,
  ways = [],
  onAdd,
  onOpen,
  onReorder,
  onDelete,
  onDismissUpload,
}: {
  pages: readonly PageThumbnailView[];
  /** Photos being prepared or uploaded, and the ones that failed. */
  uploads: readonly UploadQueueItem[];
  thumbUrl: (pageId: string) => string;
  /** Whether more can be added (free slots, and adding is open). */
  canAdd: boolean;
  /** Closes reordering and removing (a locked paper, uploads still numbering pages). */
  disabled?: boolean;
  emptyTitle: string;
  emptyHint: string;
  /** The other ways to bring the paper in (the camera, an earlier paper); see {@link PaperSourceWay}. */
  ways?: readonly PaperSourceWay[];
  onAdd: () => void;
  /** A page was pressed: the caller shows it large enough to read. */
  onOpen: (pageId: string) => void;
  onReorder: (pageIds: string[]) => void;
  onDelete: (pageId: string) => void;
  onDismissUpload: (id: string) => void;
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    // Space picks a page up and puts it down; Enter is left to the tile's own press, which opens the page.
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] } }),
  );
  const ids = pages.map((page) => page.id);
  if (pages.length === 0 && uploads.length === 0) {
    return (
      // From `sm` up the other ways in sit under the words, beside the tile. A phone has no room for them there, so they take a row of their own under the tile and the words.
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3">
        <button
          type="button"
          aria-label={`${emptyTitle}: ${emptyHint}`}
          disabled={!canAdd}
          onClick={onAdd}
          className="group/add rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 sm:row-span-2"
        >
          <AddTileFace label="Choose files" className="w-20 group-enabled/add:group-hover/add:border-primary/60 group-enabled/add:group-hover/add:text-foreground sm:w-24" />
        </button>
        {/* The words open the picker too. They repeat the tile's action for a pointer only, so they are not a second control for the keyboard or a screen reader. */}
        <button type="button" tabIndex={-1} aria-hidden disabled={!canAdd} onClick={onAdd} className="flex flex-col gap-0.5 text-left enabled:cursor-pointer sm:self-end">
          <span className="text-sm font-medium">{emptyTitle}</span>
          <span className="text-sm text-muted-foreground">{emptyHint}</span>
        </button>
        {ways.length > 0 ? (
          <div className="col-span-2 flex flex-wrap gap-2 sm:col-span-1 sm:col-start-2 sm:self-start">
            {ways.map((way) => (
              <WayButton key={way.key} way={way} />
            ))}
          </div>
        ) : null}
      </div>
    );
  }
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
        <div className="flex flex-col gap-2">
          <TrayCaption pageCount={pages.length} canReorder={!disabled} />
          <ul className="grid grid-cols-4 gap-2.5 sm:flex sm:flex-wrap" aria-label="Pages of the paper">
            {pages.map((page) => (
              <PageTile key={page.id} page={page} src={thumbUrl(page.id)} disabled={disabled} onOpen={onOpen} onDelete={onDelete} />
            ))}
            {uploads.map((item) => (
              <UploadTile key={item.id} item={item} onDismiss={onDismissUpload} />
            ))}
            {canAdd ? (
              // From `sm` up the add tile is the next page of the row. A phone's four-across grid would give it a row of its own, so there it is the compact button in the row of controls below.
              <li className="max-sm:hidden">
                <button type="button" onClick={onAdd} className="group/add block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <AddTileFace label="Add pages" className="group-hover/add:border-primary/60 group-hover/add:text-foreground" />
                </button>
              </li>
            ) : null}
            {/* The other ways to add stay with the add control: from `sm` up each is a tile after the add tile, the same shape, so the ways to add read as one group at the end of the row. */}
            {ways.map((way) => (
              <li key={way.key} className={WAY_TILE_VISIBILITY[way.pointer ?? 'any']}>
                <button
                  type="button"
                  disabled={way.disabled}
                  onClick={way.onClick}
                  className="group/add block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <AddTileFace icon={way.icon} label={way.label} className="group-enabled/add:group-hover/add:border-primary/60 group-enabled/add:group-hover/add:text-foreground" />
                </button>
              </li>
            ))}
            {/* On a phone the four-across grid would give each add tile a row of its own, so the ways to add are one row of buttons under the pages. */}
            {canAdd || ways.length > 0 ? (
              <li className="col-span-4 flex gap-2 pt-1 sm:hidden">
                {canAdd ? (
                  <button
                    type="button"
                    onClick={onAdd}
                    className="inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-lg border border-dashed border-foreground/30 px-2 text-xs/relaxed text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Plus className="size-4" aria-hidden />
                    Add pages
                  </button>
                ) : null}
                {/* The same dashed look as "Add pages" beside it: both add pages, neither is the main one. */}
                {ways.map((way) => (
                  <WayButton key={way.key} way={way} className="flex-1 border-dashed border-foreground/30 bg-transparent font-normal text-muted-foreground shadow-none dark:bg-transparent" />
                ))}
              </li>
            ) : null}
          </ul>
        </div>
      </SortableContext>
    </DndContext>
  );
}

/**
 * A source that is one thing rather than pages: a PDF, or an earlier paper
 * that is copied. One quiet row with what it is, a line of detail, its
 * progress or failure, and a way to take it out again.
 */
export function PaperSourceItem({
  icon: Icon,
  title,
  detail,
  status = 'ready',
  error,
  actions,
  removeLabel,
  onRemove,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
  status?: 'working' | 'ready' | 'failed';
  /** Why it failed, shown in place of the detail. */
  error?: string | null;
  /** A quiet action beside the remove button, such as a preview. On a phone it drops under the text and the icon makes room for it. */
  actions?: ReactNode;
  removeLabel: string;
  onRemove: () => void;
}) {
  return (
    // From `sm` up one row: icon, text, action, remove. On a phone the icon goes, the remove button stays at the top right and the action drops under the text, so its word is never cut to an icon.
    <div className={cn('grid items-center gap-x-3 gap-y-1 rounded-lg border bg-muted/40 p-2.5 max-sm:p-3 sm:flex', actions ? 'grid-cols-[minmax(0,1fr)_auto]' : 'grid-cols-[auto_minmax(0,1fr)_auto]', status === 'failed' && 'border-destructive/50')}>
      <span className={cn('grid size-10 shrink-0 place-items-center rounded-md border bg-background text-muted-foreground', actions ? 'max-sm:hidden' : 'max-sm:row-span-1')}>
        {status === 'working' ? <Spinner className="size-4" /> : <Icon className="size-4" aria-hidden />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium [overflow-wrap:anywhere]">{title}</span>
        {status === 'failed' ? (
          <span role="alert" className="text-xs text-destructive">
            {error ?? 'It could not be added.'}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">{detail}</span>
        )}
      </span>
      {actions ? <span className="max-sm:order-last max-sm:col-span-2 max-sm:-ms-2">{actions}</span> : null}
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        className="grid size-7 shrink-0 place-items-center self-start rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:size-9 sm:self-center"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
