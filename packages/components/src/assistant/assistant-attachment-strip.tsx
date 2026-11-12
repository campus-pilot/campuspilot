import { Button } from '@campuspilot/ui/components/button';
import { Spinner } from '@campuspilot/ui/components/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@campuspilot/ui/components/tooltip';
import { cn } from '@campuspilot/ui/lib/utils';
import { AlertCircle, FileImage, X } from 'lucide-react';

import type { ComposerAttachment } from './assistant-attachments-model';

/** A square image tile: the preview when there is one, else a generic file tile. */
function Thumb({ previewUrl, label, className }: { previewUrl: string | null; label: string; className?: string }) {
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

function StripItem({ item, onRemove }: { item: ComposerAttachment; onRemove: (localId: string) => void }) {
  return (
    <li className="group/attachment relative shrink-0">
      <Thumb previewUrl={item.previewUrl} label={item.fileName} className={item.status === 'failed' ? 'border-destructive/60' : undefined} />
      {item.status === 'uploading' ? (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/60" role="status" aria-label={`Uploading ${item.fileName}`}>
          <Spinner className="size-4" />
        </div>
      ) : null}
      {item.status === 'failed' ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/70 text-destructive" role="img" aria-label={item.error ?? 'Upload failed'}>
              <AlertCircle className="size-4" />
            </div>
          </TooltipTrigger>
          <TooltipContent>{item.error ?? 'The image could not be uploaded.'}</TooltipContent>
        </Tooltip>
      ) : null}
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
 * The images waiting to be sent, above the message field: a thumbnail each
 * with its progress or failure and a remove button. Scrolls sideways inside
 * itself so twenty images never widen the page.
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
    <ul aria-label="Attached images" className="flex w-full min-w-0 gap-2 overflow-x-auto px-3 pt-3 pb-1">
      {items.map((item) => (
        <StripItem key={item.localId} item={item} onRemove={onRemove} />
      ))}
    </ul>
  );
}

export type SentAttachment = { id: string; fileName: string; previewUrl: string | null };

/** The images of a message already sent, as small tiles above its bubble. */
export function AssistantSentAttachments({ attachments }: { attachments: readonly SentAttachment[] }) {
  if (attachments.length === 0) return null;
  return (
    <ul aria-label={`${attachments.length} attached ${attachments.length === 1 ? 'image' : 'images'}`} className="flex max-w-[min(80%,32.5rem)] flex-wrap justify-end gap-1.5">
      {attachments.map((attachment) => (
        <li key={attachment.id}>
          <Thumb previewUrl={attachment.previewUrl} label={attachment.fileName} />
        </li>
      ))}
    </ul>
  );
}
