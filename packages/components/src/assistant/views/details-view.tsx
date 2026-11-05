import type { AssistantDetailsView } from '@campuspilot/assistant-contract/views';

import { AssistantViewFrame } from './view-frame';

/** One item's facts as a label/value list (the admission details pattern). */
export function AssistantDetailsViewBlock({ view }: { view: AssistantDetailsView }) {
  return (
    <AssistantViewFrame title={view.title}>
      <dl className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] gap-x-4 rounded-lg border px-3 text-sm/relaxed">
        {view.fields.map((field) => (
          <div key={field.label} className="contents [&:not(:last-child)>*]:border-b [&>*]:border-border/60 [&>*]:py-2">
            <dt className="truncate text-muted-foreground">{field.label}</dt>
            <dd className="min-w-0 break-words tabular-nums">
              {typeof field.value === 'number' ? field.value.toLocaleString() : field.value || '—'}
            </dd>
          </div>
        ))}
      </dl>
    </AssistantViewFrame>
  );
}
