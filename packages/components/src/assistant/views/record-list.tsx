import { Skeleton } from '@campuspilot/ui/components/skeleton';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { AssistantViewFrame } from './view-frame';

export type AssistantRecord = {
  id: string;
  /** Avatar or icon tile. */
  leading: ReactNode;
  title: string;
  subtitle?: string;
  /** A status badge, already styled by the caller's vocabulary. */
  badge?: ReactNode;
  href?: string;
};

/**
 * Platform records as rows (the command palette's record row): leading tile,
 * name, one line of context, status, and a link to the record.
 */
export function AssistantRecordList({
  title,
  records,
  loadingCount = 0,
  unavailable = 0,
  renderLink,
}: {
  title?: string;
  records: readonly AssistantRecord[];
  /** Placeholder rows while records load. */
  loadingCount?: number;
  /** Records the user cannot see or that no longer exist. */
  unavailable?: number;
  renderLink: (props: { href: string; className: string; children: ReactNode }) => ReactNode;
}) {
  return (
    <AssistantViewFrame title={title}>
      <ul className="flex flex-col overflow-hidden rounded-lg border">
        {records.map((record) => {
          const content = (
            <>
              <span className="flex shrink-0">{record.leading}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{record.title}</span>
                {record.subtitle ? <span className="truncate text-xs text-muted-foreground">{record.subtitle}</span> : null}
              </span>
              {record.badge}
              {record.href ? <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : null}
            </>
          );
          const rowClass = 'flex min-h-12 items-center gap-3 px-3 py-2';
          return (
            <li key={record.id} className="border-b border-border/60 last:border-b-0">
              {record.href
                ? renderLink({ href: record.href, className: `${rowClass} transition-colors hover:bg-muted/50`, children: content })
                : <div className={rowClass}>{content}</div>}
            </li>
          );
        })}
        {Array.from({ length: loadingCount }, (_, index) => (
          <li key={`loading-${index}`} className="flex min-h-12 items-center gap-3 border-b border-border/60 px-3 py-2 last:border-b-0">
            <Skeleton className="size-8 rounded-full" />
            <span className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-2.5 w-1/4" />
            </span>
          </li>
        ))}
      </ul>
      {unavailable > 0 ? (
        <p className="text-xs text-muted-foreground">
          {unavailable === 1 ? '1 record is' : `${unavailable} records are`} not available to you.
        </p>
      ) : null}
    </AssistantViewFrame>
  );
}
