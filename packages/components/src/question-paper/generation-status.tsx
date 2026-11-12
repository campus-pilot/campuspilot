import { Button } from '@campuspilot/ui/components/button';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import { generationStatusLabel } from './question-paper-model';

export type GenerationJobView =
  | { status: 'queued' | 'running' }
  | { status: 'failed'; /** The safe message the server stored, never a developer detail. */ message: string | null };

/**
 * What the background generation is doing. A running job is announced politely
 * to assistive technology; a failed one shows the stored safe message and, when
 * `onRetry` is given, a retry.
 */
export function GenerationStatus({ job, onRetry, retryDisabled = false }: {
  job: GenerationJobView;
  onRetry?: () => void;
  retryDisabled?: boolean;
}) {
  if (job.status === 'failed') {
    return (
      <div role="alert" className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
        <p className="flex items-start gap-2 text-sm font-medium text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {generationStatusLabel('failed')}
        </p>
        {job.message ? <p className="text-sm text-muted-foreground">{job.message}</p> : null}
        {onRetry ? (
          <div>
            <Button type="button" size="sm" variant="outline" disabled={retryDisabled} onClick={onRetry}>
              Try again
            </Button>
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div role="status" className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
      <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden />
      <span>{generationStatusLabel(job.status)}</span>
      <span className="text-xs text-muted-foreground">You can leave this page; it keeps going.</span>
    </div>
  );
}
