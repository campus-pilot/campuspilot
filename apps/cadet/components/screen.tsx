import type { ReactNode } from 'react';
import { AlertCircleIcon, type LucideIcon } from 'lucide-react';
import { Button } from '@campuspilot/ui/components/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@campuspilot/ui/components/empty';
import { Skeleton } from '@campuspilot/ui/components/skeleton';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@campuspilot/ui/components/reui/alert';

/** Screen heading with an optional trailing action. */
export function ScreenHeader({ title, description, action }: { title: string; description?: string | null; action?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** Small uppercase label above a group of rows. */
export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</h2>
      {action}
    </div>
  );
}

/** Placeholder blocks while a screen's data loads. */
export function ScreenLoading({ blocks = 3 }: { blocks?: number }) {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-12 w-2/3" />
      {Array.from({ length: blocks }, (_, index) => (
        <Skeleton key={index} className="h-28 w-full" />
      ))}
    </div>
  );
}

/** A failed read, with a retry that refetches only that data. */
export function ScreenError({ title = 'Could not load this', error, onRetry }: { title?: string; error: unknown; onRetry: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertCircleIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{error instanceof Error ? error.message : 'Check your connection and try again.'}</AlertDescription>
      <AlertAction>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </AlertAction>
    </Alert>
  );
}

/** Explains why there is nothing to show yet. */
export function EmptyState({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <Empty className="flex-none border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
