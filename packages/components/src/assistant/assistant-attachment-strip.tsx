import type { AssistantAttachmentKind } from '@campuspilot/assistant-contract/attachments';
import { Button } from '@campuspilot/ui/components/button';
import { Spinner } from '@campuspilot/ui/components/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@campuspilot/ui/components/tooltip';
import { cn } from '@campuspilot/ui/lib/utils';
import { AlertCircle, FileImage, FileText, X } from 'lucide-react';
import { useState } from 'react';

import {
  formatAttachmentSize,
  viewableImagesOf,
  type ComposerAttachment,
  type SentAttachment,
} from './assistant-attachments-model';
import { AssistantImageViewer } from './assistant-image-viewer';

/** A square image tile: the preview when there is one, else a generic file tile. */
function ImageThumb({ previewUrl, label, className }: { previewUrl: string | null; label: string; className?: string }) {
  return (
    <div className={cn('relative size-14 shrink-0 overflow-hidden rounded-lg border border-border/60 bg-muted', className)}>
      <FileImage className="absolute inset-0 m-auto size-5 text-muted-foreground" aria-hidden />
      {previewUrl ? (
        // The generic tile behind shows if the preview cannot load (HEIC the server could not decode).
        <img
          src={previewUrl}
          alt={label}
          loading="lazy"
          className="relative size-full object-cover"
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * A PDF tile: a file icon, the name and the size, the same height as an image
 * tile. A document is never previewed: its bytes are not served to the browser.
 */
function DocumentTile({ name, byteSize, className }: { name: string; byteSize: number; className?: string }) {
  return (
    <div
      role="img"
      aria-label={`${name}, PDF, ${formatAttachmentSize(byteSize)}`}
      className={cn('flex h-14 w-44 shrink-0 items-center gap-2 overflow-hidden rounded-lg border border-border/60 bg-muted px-2.5', className)}
    >
      <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="flex min-w-0 flex-col" aria-hidden>
        <span className="truncate text-xs font-medium text-foreground">{name}</span>
        <span className="text-[0.6875rem] text-muted-foreground">PDF · {formatAttachmentSize(byteSize)}</span>
      </div>
    </div>
  );
}

/** One attachment as a tile, by its kind. */
function AttachmentTile({
  kind,
  name,
  byteSize,
  previewUrl,
  className,
}: {
  kind: AssistantAttachmentKind;
  name: string;
  byteSize: number;
  previewUrl: string | null;
  className?: string;
}) {
  return kind === 'document' ? (
    <DocumentTile name={name} byteSize={byteSize} className={className} />
  ) : (
    <ImageThumb previewUrl={previewUrl} label={name} className={className} />
  );
}

/** The failure mark over a tile, with its reason on hover. */
function FailedOverlay({ error }: { error: string | null }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/70 text-destructive" role="img" aria-label={error ?? 'Upload failed'}>
          <AlertCircle className="size-4" />
        </div>
      </TooltipTrigger>
      <TooltipContent>{error ?? 'The file could not be uploaded.'}</TooltipContent>
    </Tooltip>
  );
}

function StripItem({ item, onRemove }: { item: ComposerAttachment; onRemove: (localId: string) => void }) {
  return (
    <li className="group/attachment relative shrink-0">
      <AttachmentTile
        kind={item.kind}
        name={item.fileName}
        byteSize={item.byteSize}
        previewUrl={item.previewUrl}
        className={item.status === 'failed' ? 'border-destructive/60' : undefined}
      />
      {item.status === 'uploading' ? (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/60" role="status" aria-label={`Uploading ${item.fileName}`}>
          <Spinner className="size-4" />
        </div>
      ) : null}
      {item.status === 'failed' ? <FailedOverlay error={item.error} /> : null}
      <Button
        type="button"
        variant="secondary"
        size="icon-sm"
        aria-label={`Remove ${item.fileName}`}
        className="absolute -end-1.5 -top-1.5 size-5 rounded-full border border-border/60 shadow-xs"
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => onRemove(item.localId)}
      >
        <X className="size-3" />
      </Button>
    </li>
  );
}

/**
 * The images and PDFs waiting to be sent, above the message field: a tile
 * each with its progress or failure and a remove button. Scrolls sideways
 * inside itself so twenty files never widen the page.
 */
export function AssistantAttachmentStrip({
  items,
  onRemove,
}: {
  items: readonly ComposerAttachment[];
  onRemove: (localId: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <ul aria-label="Attached files" className="flex w-full min-w-0 gap-2 overflow-x-auto px-3 pt-3 pb-1">
      {items.map((item) => (
        <StripItem key={item.localId} item={item} onRemove={onRemove} />
      ))}
    </ul>
  );
}

/** A sent image's tile as a button that opens the full-screen viewer on it. */
function ViewableTile({ attachment, onOpen }: { attachment: SentAttachment; onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-label={`View ${attachment.fileName}`}
      onClick={onOpen}
      className="block cursor-zoom-in rounded-lg outline-none transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ImageThumb previewUrl={attachment.previewUrl} label={attachment.fileName} />
    </button>
  );
}

/**
 * The files of a message already sent, as small tiles above its bubble. An
 * image with an original address opens the viewer on itself, among the
 * message's other viewable images; a document or an undecodable image is a
 * plain tile.
 */
export function AssistantSentAttachments({ attachments }: { attachments: readonly SentAttachment[] }) {
  // The index outlives `open` so the viewer keeps its image while it fades out.
  const [viewer, setViewer] = useState({ open: false, index: 0 });
  if (attachments.length === 0) return null;
  const images = viewableImagesOf(attachments);
  return (
    <>
      <ul aria-label={`${attachments.length} attached ${attachments.length === 1 ? 'file' : 'files'}`} className="flex max-w-[min(80%,32.5rem)] flex-wrap justify-end gap-1.5">
        {attachments.map((attachment) => {
          const index = images.findIndex((image) => image.id === attachment.id);
          return (
            <li key={attachment.id}>
              {index >= 0 ? (
                <ViewableTile attachment={attachment} onOpen={() => setViewer({ open: true, index })} />
              ) : (
                <AttachmentTile kind={attachment.kind} name={attachment.fileName} byteSize={attachment.byteSize} previewUrl={attachment.previewUrl} />
              )}
            </li>
          );
        })}
      </ul>
      <AssistantImageViewer images={images} openedOn={viewer.index} open={viewer.open} onOpenChange={(open) => setViewer((current) => ({ ...current, open }))} />
    </>
  );
}
