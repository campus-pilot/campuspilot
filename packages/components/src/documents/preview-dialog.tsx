'use client';

import type { ReactNode } from 'react';
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@campuspilot/ui/components/dialog';
import { cn } from '@campuspilot/ui/lib/utils';

/**
 * How much of the screen a preview dialog takes:
 * - `tall`: a column as tall as the screen allows, never taller (the chat's
 *   question paper draft and version previews). A centred dialog has no
 *   scroll of its own, so a taller one hid its title, close button and the
 *   document's end on a phone.
 * - `full`: the whole screen on a phone and all but a small margin on a
 *   larger screen (the template marketplace), for looking a document over
 *   page by page.
 */
export type PreviewDialogSize = 'tall' | 'full';

const SIZE_CLASSES: Record<PreviewDialogSize, string> = {
  tall: 'h-[88dvh] sm:max-w-3xl',
  full: 'h-dvh w-screen max-w-none rounded-none p-3 sm:h-[calc(100dvh-2rem)] sm:w-[calc(100vw-2rem)] sm:max-w-none sm:rounded-xl sm:p-4',
};

/** The dialog's title, description and optional actions; the actions clear the close button in the corner. */
function PreviewDialogHeader({ title, description, actions }: { title: string; description: ReactNode; actions?: ReactNode }) {
  return (
    <DialogHeader className={cn(actions && 'gap-3 pr-8 sm:flex-row sm:items-start sm:justify-between')}>
      <div className="flex min-w-0 flex-col gap-1">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-start gap-2">{actions}</div> : null}
    </DialogHeader>
  );
}

/**
 * The content of a dialog that shows a document preview: a header, then the
 * preview filling the rest of the dialog's height (a `PdfPreview` or
 * `DocumentPreview` with `fill` scrolls inside it). Put it inside a `Dialog`
 * (with a `DialogTrigger`, or controlled with `open`); Radix mounts it, and
 * so the preview's request, only while the dialog is open. Presentational:
 * the caller supplies the preview and any actions.
 */
export function PreviewDialogContent({
  title,
  description,
  actions,
  size = 'tall',
  children,
}: {
  title: string;
  description: ReactNode;
  /** Shown beside the title (beneath it on a phone), such as "Use template". */
  actions?: ReactNode;
  size?: PreviewDialogSize;
  children: ReactNode;
}) {
  return (
    <DialogContent className={cn('flex flex-col', SIZE_CLASSES[size])}>
      <PreviewDialogHeader title={title} description={description} actions={actions} />
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </DialogContent>
  );
}
