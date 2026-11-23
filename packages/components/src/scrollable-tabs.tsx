'use client';

import type { ComponentProps } from 'react';
import { TabsList } from '@campuspilot/ui/components/tabs';
import { cn } from '@campuspilot/ui/lib/utils';

/**
 * A tab row that scrolls sideways when its tabs do not fit (a phone, or more
 * tabs than the width holds) instead of squeezing or wrapping them. Give each
 * trigger `flex-none` so it keeps its natural width, and an explicit height
 * (`h-9` for line tabs, `h-7` for the default pills): the row's height
 * follows its triggers.
 *
 * `overflow-x-auto` clips what hangs below the box, so the row's height is
 * auto under the same `group-data-horizontal/tabs` variant as the shared
 * `h-8` it replaces (a plain `h-auto` loses to it): at a fixed height, taller
 * triggers, or a desktop scrollbar under them, overflow the row and the
 * browser shows a second, vertical scrollbar. A `line` row's active
 * underline sits 1px under the triggers, so that row pads 1px to hold it.
 * The row only ever scrolls sideways, so its vertical overflow is hidden: a
 * trigger's positioned underline (present, but transparent, in the `default`
 * pill variant) still reaches past the row and would otherwise add a
 * vertical scrollbar (`overflow-x-auto` makes the other axis `auto` too).
 */
export function ScrollableTabsList({ className, variant = 'line', ...props }: ComponentProps<typeof TabsList>) {
  return (
    <TabsList
      variant={variant}
      className={cn(
        'max-w-full justify-start overflow-x-auto overflow-y-hidden group-data-horizontal/tabs:h-auto',
        variant === 'line' && 'pb-px',
        className,
      )}
      {...props}
    />
  );
}
