'use client';

import { Button } from '@campuspilot/ui/components/button';
import { RefreshCw } from 'lucide-react';

const computedAtFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

/**
 * When the shown usage was computed, with a button to compute it again. The
 * usage procedures cache their answer for an hour, so the time is the
 * answer's own `computedAt` (IST), not when the page loaded. A refresh
 * replaces the cached answer for everyone who reads the same range.
 */
export function UsageFreshness({
  computedAt,
  refreshing,
  onRefresh,
}: {
  /** ISO 8601 time the figures were computed. */
  computedAt: string;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span>Updated {computedAtFormat.format(new Date(computedAt))} IST</span>
      <Button type="button" variant="outline" onClick={onRefresh} disabled={refreshing}>
        <RefreshCw data-icon="inline-start" className={refreshing ? 'animate-spin' : undefined} />
        {refreshing ? 'Refreshing' : 'Refresh'}
      </Button>
    </div>
  );
}
