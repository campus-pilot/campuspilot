'use client';

import { Button } from '@campuspilot/ui/components/button';
import { cn } from '@campuspilot/ui/lib/utils';

/**
 * The quiet note for data that stays on screen after a background refresh
 * failed: `resolveQueryBoundary` keeps the held copy (`ready`) and reports
 * the failure as `refetchError`; this says so in one muted line with Retry,
 * instead of replacing the page or saying nothing. Renders nothing while
 * there is no such error. API-free: the caller passes the error and the
 * retry.
 */
export function QueryRefreshNote({
  error,
  onRetry,
  className,
}: {
  /** `refetchError` from a `ready` boundary state; nothing is shown for null or undefined. */
  error: unknown;
  onRetry: () => void;
  className?: string;
}) {
  if (error === null || error === undefined) return null;
  return (
    <p role="status" className={cn('flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground', className)}>
      <span>Couldn&apos;t refresh. Showing the last loaded version.</span>
      <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={onRetry}>
        Retry
      </Button>
    </p>
  );
}
