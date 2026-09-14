'use client';

import { useRef } from 'react';
import { useForm } from '@tanstack/react-form';
import { Search, X } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@campuspilot/ui/components/button';
import { Input } from '@campuspilot/ui/components/input';

const tableSearchSchema = z.object({
  searchQuery: z.string().max(200, 'Search cannot exceed 200 characters.'),
});

export type TableSearchBarProps = {
  defaultValue?: string;
  debounceMs?: number;
  placeholder?: string;
  onSearchChange: (searchQuery: string | undefined) => void;
};

/**
 * Shared, validated table search input. It owns only the draft text; the
 * normalized query is returned to the route so filtering can remain local or
 * be sent to a server-side list procedure.
 */
export function TableSearchBar({
  defaultValue = '',
  debounceMs = 300,
  placeholder = 'Search…',
  onSearchChange,
}: TableSearchBarProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const form = useForm({
    defaultValues: { searchQuery: defaultValue },
    validators: { onChange: tableSearchSchema },
    onSubmit: ({ value }) => emitSearch(value.searchQuery),
  });

  function clearTimer() {
    if (timerRef.current === undefined) return;
    clearTimeout(timerRef.current);
    timerRef.current = undefined;
  }

  function emitSearch(value: string) {
    clearTimer();
    const normalizedValue = value.trim();
    onSearchChange(normalizedValue || undefined);
  }

  function scheduleSearch(value: string) {
    clearTimer();
    timerRef.current = setTimeout(() => {
      emitSearch(value);
    }, debounceMs);
  }

  return (
    <form
      className="flex w-full max-w-sm flex-col gap-1"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <form.Field name="searchQuery">
        {(field) => (
          <>
            <div className="relative">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                aria-label="Search table"
                aria-invalid={field.state.meta.errors.length > 0}
                className="pl-7 pr-8"
                maxLength={200}
                placeholder={placeholder}
                value={field.state.value}
                onBlur={() => {
                  field.handleBlur();
                  emitSearch(field.state.value);
                }}
                onChange={(event) => {
                  field.handleChange(event.target.value);
                  scheduleSearch(event.target.value);
                }}
              />
              {field.state.value ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Clear table search"
                  className="absolute right-1 top-1/2 -translate-y-1/2"
                  onClick={() => {
                    clearTimer();
                    field.handleChange('');
                    onSearchChange(undefined);
                  }}
                >
                  <X aria-hidden />
                </Button>
              ) : null}
            </div>
            {field.state.meta.errors.map((error, index) => {
              const message =
                typeof error === 'object' &&
                error !== null &&
                'message' in error
                  ? String(error.message)
                  : undefined;
              return message ? (
                <p key={`${message}-${index}`} className="text-xs text-destructive">
                  {message}
                </p>
              ) : null;
            })}
          </>
        )}
      </form.Field>
    </form>
  );
}
