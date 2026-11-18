import type { ReactNode } from 'react';

/**
 * What an empty table says, with an optional next step under it (for
 * example "Add classroom" when nothing has been created yet). The caller
 * decides when an action belongs there and gates it: a list emptied by a
 * search or a filter passes no action.
 */
export function TableEmptyMessage({ message, action }: { message: ReactNode; action?: ReactNode }) {
  if (!action) return message;
  return (
    <div className="flex flex-col items-center gap-3">
      <span>{message}</span>
      {action}
    </div>
  );
}
