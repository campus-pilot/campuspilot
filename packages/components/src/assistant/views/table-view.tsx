import type { AssistantTableView } from '@campuspilot/assistant-contract/views';
import { Badge } from '@campuspilot/ui/components/badge';
import { cn } from '@campuspilot/ui/lib/utils';

import { AssistantViewFrame } from './view-frame';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

function Cell({ value, format }: { value: string | number | null | undefined; format?: string }) {
  if (value === null || value === undefined || value === '') return <span className="text-muted-foreground">—</span>;
  if (format === 'badge') return <Badge variant="outline">{String(value)}</Badge>;
  if (format === 'date' && typeof value === 'string' && !Number.isNaN(Date.parse(value))) {
    return <time dateTime={value}>{dateFormat.format(new Date(value))}</time>;
  }
  return <>{typeof value === 'number' ? value.toLocaleString() : value}</>;
}

/** Rows of data in an inset well: tinted header, hairline rows and columns (T3 Code tables). */
export function AssistantTableViewBlock({ view }: { view: AssistantTableView }) {
  const end = (format?: string) => format === 'number' || format === 'date';
  return (
    <AssistantViewFrame title={view.title}>
      <div className="overflow-x-auto rounded-[10px] assistant-well [scrollbar-width:thin]">
        <table className="w-full border-separate border-spacing-0 text-[13px]/5">
          <thead>
            <tr>
              {view.columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    'border-b border-border bg-[var(--assistant-well-header)] px-3 py-2 font-medium whitespace-nowrap text-foreground [&:not(:last-child)]:border-e [&:not(:last-child)]:border-e-assistant-hairline',
                    end(column.format) ? 'text-end' : 'text-start',
                  )}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row, index) => (
              <tr key={index} className="[&:not(:last-child)>td]:border-b [&>td]:border-assistant-hairline">
                {view.columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      'max-w-80 px-3 py-2 align-top text-pretty [&:not(:last-child)]:border-e',
                      end(column.format) ? 'text-end tabular-nums' : 'text-start',
                    )}
                  >
                    <Cell value={row[column.key]} format={column.format} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {view.rows.length === 0 ? <p className="text-[13px] text-muted-foreground">Nothing to show.</p> : null}
      {view.footnote ? <p className="text-xs text-assistant-dim">{view.footnote}</p> : null}
    </AssistantViewFrame>
  );
}
