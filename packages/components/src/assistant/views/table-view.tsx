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

/** Rows of data with row hairlines only, flush with the prose (T3 Code tables). */
export function AssistantTableViewBlock({ view }: { view: AssistantTableView }) {
  const end = (format?: string) => format === 'number' || format === 'date';
  return (
    <AssistantViewFrame title={view.title}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[0.8125rem]/relaxed">
          <thead>
            <tr className="border-b">
              {view.columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    'px-3 py-2 font-medium whitespace-nowrap text-muted-foreground first:ps-0 last:pe-0',
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
              <tr key={index} className="border-b border-border/60 last:border-b-0">
                {view.columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      'max-w-80 px-3 py-2 align-top text-pretty first:ps-0 last:pe-0',
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
      {view.rows.length === 0 ? <p className="text-sm text-muted-foreground">No rows.</p> : null}
      {view.footnote ? <p className="text-xs text-muted-foreground">{view.footnote}</p> : null}
    </AssistantViewFrame>
  );
}
