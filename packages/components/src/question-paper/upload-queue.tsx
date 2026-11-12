import { Button } from '@campuspilot/ui/components/button';
import { CircleAlert, FileImage, LoaderCircle, X } from 'lucide-react';

export type UploadQueueItem = {
  id: string;
  name: string;
  /** A local preview, shown at once. Absent for a HEIC original the browser cannot draw. */
  previewUrl?: string;
  status: 'converting' | 'uploading' | 'error';
  error?: string;
};

const STATUS_TEXT = { converting: 'Preparing…', uploading: 'Uploading…' } as const;

function QueueRow({ item, onDismiss }: { item: UploadQueueItem; onDismiss: (id: string) => void }) {
  return (
    <li className="flex items-center gap-3 rounded-lg border p-2">
      <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md bg-muted/40">
        {item.previewUrl ? (
          <img src={item.previewUrl} alt="" className="size-full object-cover" />
        ) : (
          <FileImage className="size-5 text-muted-foreground" aria-hidden />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="truncate text-sm font-medium" title={item.name}>
          {item.name}
        </p>
        {item.status === 'error' ? (
          <p className="flex items-start gap-1 text-xs text-destructive" role="alert">
            <CircleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
            {item.error ?? 'The upload failed.'}
          </p>
        ) : (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <LoaderCircle className="size-3 animate-spin" aria-hidden />
            {STATUS_TEXT[item.status]}
          </p>
        )}
      </div>
      {item.status === 'error' ? (
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Dismiss ${item.name}`} onClick={() => onDismiss(item.id)}>
          <X aria-hidden />
        </Button>
      ) : null}
    </li>
  );
}

/** Photos on their way to the server, with a local preview each; a failed one stays until dismissed. */
export function UploadQueue({ items, onDismiss }: { items: readonly UploadQueueItem[]; onDismiss: (id: string) => void }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2" aria-label="Uploads in progress">
      {items.map((item) => (
        <QueueRow key={item.id} item={item} onDismiss={onDismiss} />
      ))}
    </ul>
  );
}
