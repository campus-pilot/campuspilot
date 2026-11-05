import type { AssistantBarsView } from '@campuspilot/assistant-contract/views';
import { cn } from '@campuspilot/ui/lib/utils';

import { TONE_BAR } from './view-tone';
import { AssistantViewFrame } from './view-frame';

/** Amounts compared as the dashboard's bar lists. */
export function AssistantBarsViewBlock({ view }: { view: AssistantBarsView }) {
  const max = Math.max(...view.bars.map((bar) => bar.value), 1);
  return (
    <AssistantViewFrame title={view.title}>
      <ul className="flex flex-col gap-2">
        {view.bars.map((bar) => (
          <li key={bar.label} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm/relaxed">
              <span className="truncate">{bar.label}</span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {bar.value.toLocaleString()}
                {view.unit ? ` ${view.unit}` : ''}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div
                className={cn('h-full rounded-full', TONE_BAR[bar.tone ?? 'neutral'])}
                style={{ width: `${Math.max((bar.value / max) * 100, bar.value > 0 ? 2 : 0)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </AssistantViewFrame>
  );
}
