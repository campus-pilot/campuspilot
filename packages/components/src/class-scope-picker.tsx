'use client';

import { useId, type ReactNode } from 'react';
import { ChevronsUpDown } from 'lucide-react';
import { Button } from '@campuspilot/ui/components/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@campuspilot/ui/components/command';
import { Label } from '@campuspilot/ui/components/label';
import { Popover, PopoverContent, PopoverTrigger } from '@campuspilot/ui/components/popover';

import { classScopeSummary, filterClassScopeOptions, pageClassScopeOptions, toggleClassScopeId, type ClassScopeOption } from './class-scope-picker-model';

export type { ClassScopeOption } from './class-scope-picker-model';

export type ClassScopePickerProps = {
  /** Every class on offer, in display order. */
  classes: readonly ClassScopeOption[];
  /** The checked classes, as explicit IDs. What "none" or "all" means is the caller's decision. */
  selectedIds: readonly string[];
  onSelectedIdsChange: (ids: string[]) => void;
  /** Search text and page are owned by the caller's form, like every other input. */
  search: string;
  page: number;
  onSearchChange: (search: string) => void;
  onPageChange: (page: number) => void;
  isPending?: boolean;
  isError?: boolean;
  label?: string;
  /** The DOM id of the trigger, for a caller that moves focus to it; generated when omitted. */
  id?: string;
  /** Trigger text; defaults to "N of M classes". */
  summary?: string;
  /** Marks the trigger invalid for assistive technology. */
  invalid?: boolean;
  /** The id of the element holding this field's error text (in `children`); announced with the trigger while `invalid`. */
  errorId?: string;
  /** Extra controls under the list (for example "Select all classes"). */
  footer?: ReactNode;
  /** Help text or field errors under the trigger. */
  children?: ReactNode;
};

function ClassScopePager({ currentPage, totalPages, onPageChange }: { currentPage: number; totalPages: number; onPageChange: (page: number) => void }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="text-xs text-muted-foreground">Page {currentPage} of {totalPages}</span>
      <Button type="button" size="sm" variant="outline" disabled={currentPage <= 1} onClick={() => onPageChange(currentPage - 1)}>Previous</Button>
      <Button type="button" size="sm" variant="outline" disabled={currentPage >= totalPages} onClick={() => onPageChange(currentPage + 1)}>Next</Button>
    </div>
  );
}

function ClassScopeList({ classes, selectedIds, search, page, footer, onSelectedIdsChange, onSearchChange, onPageChange }: Pick<ClassScopePickerProps, 'classes' | 'selectedIds' | 'search' | 'page' | 'footer' | 'onSelectedIdsChange' | 'onSearchChange' | 'onPageChange'>) {
  const selected = new Set(selectedIds);
  const { visible, totalPages, currentPage } = pageClassScopeOptions(filterClassScopeOptions(classes, search), page);
  return (
    <Command shouldFilter={false}>
      <CommandInput value={search} placeholder="Search classes…" onValueChange={(value) => { onSearchChange(value); onPageChange(1); }} />
      <CommandList aria-multiselectable="true" aria-label="Classes; choose one or more">
        <CommandEmpty>No classes match this search.</CommandEmpty>
        <CommandGroup heading="Classes in this session">
          {visible.map((item) => {
            const checked = selected.has(item.id);
            return (
              // cmdk's own `aria-selected` follows the highlighted row, not
              // the choice, so the choice is stated in words as well: a
              // screen reader hears "Class 5, selected". The visible check
              // is the shared CommandItem's own (shown for `data-checked`,
              // as in the school switcher); the row adds none of its own.
              <CommandItem key={item.id} value={item.id} data-checked={checked || undefined} onSelect={() => onSelectedIdsChange(toggleClassScopeId(classes, selectedIds, item.id))}>
                <span className="truncate">{item.label}</span>
                <span className="sr-only">{checked ? ', selected' : ', not selected'}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
      <div className="flex flex-col gap-2 border-t p-2">
        {footer}
        <ClassScopePager currentPage={currentPage} totalPages={totalPages} onPageChange={onPageChange} />
      </div>
    </Command>
  );
}

/**
 * A searchable, paginated multi-select of a session's classes in a popover.
 * It is API-free and fully controlled: the caller supplies the classes and
 * owns the selection, the search text and the page (in its form), and
 * decides what an empty or complete selection means. Built on Radix Popover
 * and cmdk, so it stays interactive inside a Radix dialog.
 */
export function ClassScopePicker({ classes, selectedIds, isPending = false, isError = false, label = 'Classes', summary, invalid = false, errorId, id: givenId, children, ...list }: ClassScopePickerProps) {
  const generatedId = useId();
  const id = givenId ?? generatedId;
  const text = isPending ? 'Loading classes…' : (summary ?? classScopeSummary(selectedIds.length, classes.length));
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button id={id} type="button" variant="outline" role="combobox" aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined} className="w-full justify-between" disabled={isPending || isError}>
            <span className="truncate">{text}</span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-72 max-w-[calc(100vw-2rem)] p-0">
          <ClassScopeList classes={classes} selectedIds={selectedIds} {...list} />
        </PopoverContent>
      </Popover>
      {isError ? <p className="text-xs text-destructive">Unable to load classes.</p> : children}
    </div>
  );
}
