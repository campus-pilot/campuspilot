import type { AssistantStatsView } from '@campuspilot/assistant-contract/views';
import { cn } from '@campuspilot/ui/lib/utils';

import { TONE_DOT } from './view-tone';
import { AssistantViewFrame } from './view-frame';

/**
 * Columns for a number of tiles: one, two (also for four, as 2 by 2), or
 * three from the `sm` width up. Phones always get two columns, so an odd
 * number of tiles would leave a hole beside the last one; that tile spans
 * the row there instead.
 */
function statsGrid(count: number): string {
  if (count === 1) return 'grid-cols-1';
  const oddOnPhones = count % 2 === 1 && 'max-sm:[&>*:last-child]:col-span-2';
  return cn('grid-cols-2', count !== 2 && count !== 4 && 'sm:grid-cols-3', oddOnPhones);
}

/** Headline numbers as the dashboard's count tiles. */
export function AssistantStatsViewBlock({ view }: { view: AssistantStatsView }) {
  return (
    <AssistantViewFrame title={view.title}>
      <dl className={cn('grid gap-2', statsGrid(view.stats.length))}>
        {view.stats.map((stat, index) => (
          <div key={`${index}:${stat.label}`} className="flex min-w-0 flex-col gap-1 rounded-xl assistant-well px-3 py-2.5">
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {stat.tone ? <span className={cn('size-1.5 shrink-0 rounded-full', TONE_DOT[stat.tone])} aria-hidden /> : null}
              <span className="truncate">{stat.label}</span>
            </dt>
            <dd className="text-xl/7 font-semibold text-foreground tabular-nums tracking-tight">
              {typeof stat.value === 'number' ? stat.value.toLocaleString() : stat.value}
            </dd>
            {stat.detail ? <dd className="line-clamp-2 text-xs text-assistant-dim">{stat.detail}</dd> : null}
          </div>
        ))}
      </dl>
    </AssistantViewFrame>
  );
}
