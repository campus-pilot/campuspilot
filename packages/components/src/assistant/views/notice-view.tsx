import type { AssistantNoticeView } from '@campuspilot/assistant-contract/views';
import { cn } from '@campuspilot/ui/lib/utils';
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from 'lucide-react';

import { TONE_TEXT } from './view-tone';

const ICONS = { neutral: Info, positive: CheckCircle2, warning: AlertTriangle, negative: OctagonAlert } as const;

/** One important caution or confirmation, as the app's notice boxes. */
export function AssistantNoticeViewBlock({ view }: { view: AssistantNoticeView }) {
  const Icon = ICONS[view.tone];
  return (
    <div className="px-1">
      <div role="note" className="flex gap-2.5 rounded-lg border p-3 text-sm/relaxed">
        <Icon className={cn('mt-0.5 size-4 shrink-0', TONE_TEXT[view.tone])} aria-hidden />
        <div className="flex min-w-0 flex-col gap-0.5">
          {view.title ? <p className="font-medium">{view.title}</p> : null}
          <p className="text-muted-foreground">{view.text}</p>
        </div>
      </div>
    </div>
  );
}
