import type { AssistantStatsView } from '@campuspilot/assistant-contract/views';
import { cn } from '@campuspilot/ui/lib/utils';

import { TONE_DOT } from './view-tone';
import { AssistantViewFrame } from './view-frame';

/** Headline numbers as the dashboard's count tiles. */
export function AssistantStatsViewBlock({ view }: { view: AssistantStatsView }) {
  return (
    <AssistantViewFrame title={view.title}>
      <dl
        className={cn(
          'grid gap-2',
          view.stats.length === 1 ? 'grid-cols-1' : view.stats.length === 2 || view.stats.length === 4 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3',
        )}
      >
        {view.stats.map((stat) => (
          <div key={stat.label} className="flex min-w-0 flex-col gap-1 rounded-xl assistant-well px-3 py-2.5">
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {stat.tone ? <span className={cn('size-1.5 shrink-0 rounded-full', TONE_DOT[stat.tone])} aria-hidden /> : null}
              <span className="truncate">{stat.label}</span>
            </dt>
            <dd className="text-xl/7 font-semibold text-foreground tabular-nums tracking-tight">
              {typeof stat.value === 'number' ? stat.value.toLocaleString() : stat.value}
            </dd>
            {stat.detail ? <dd className="truncate text-xs text-assistant-dim">{stat.detail}</dd> : null}
          </div>
        ))}
      </dl>
    </AssistantViewFrame>
  );
}
