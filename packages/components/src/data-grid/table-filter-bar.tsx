'use client';

import { useMemo, useState, type ComponentType, type ReactNode, type SVGProps } from 'react';
import { Check, Plus, Search, X } from 'lucide-react';
import { Badge } from '@campuspilot/ui/components/badge';
import { Button } from '@campuspilot/ui/components/button';
import { Checkbox } from '@campuspilot/ui/components/checkbox';
import { Input } from '@campuspilot/ui/components/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@campuspilot/ui/components/popover';
import { ScrollArea } from '@campuspilot/ui/components/scroll-area';

export type TableFilterOption<
  TValue extends string | number = string | number,
> = {
  label: string;
  value: TValue;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
};

export type TableFilterConfig<
  TKey extends string = string,
  TValue extends string | number = string | number,
> = {
  id: TKey;
  label: string;
  type: 'single' | 'multiple';
  options: TableFilterOption<TValue>[];
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  placeholder?: string;
};

export type TableFilterValues = Record<
  string,
  string | number | (string | number)[] | undefined
>;

export type TableFilterBarProps<
  TFilters extends TableFilterValues = TableFilterValues,
> = {
  filters: TableFilterConfig<Extract<keyof TFilters, string>, any>[];
  values: TFilters;
  onValuesChange: (values: TFilters) => void;
  className?: string;
  actions?: ReactNode;
};

type ActiveBadge = {
  id: string;
  filterId: string;
  filterLabel: string;
  optionLabel: string;
  onRemove: () => void;
};

/**
 * Renders individual filter popovers and tag badges.
 * When an option is selected, it immediately appears on the left as a removable badge tag.
 * Supports both multi-select and single-select filter modes.
 */
function FilterPopover({
  config,
  currentValue,
  onSelect,
}: {
  config: TableFilterConfig<any, any>;
  currentValue: string | number | (string | number)[] | undefined;
  onSelect: (nextValue: string | number | (string | number)[] | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const selectedValues = useMemo<Set<string | number>>(() => {
    if (config.type === 'multiple') {
      return new Set(Array.isArray(currentValue) ? currentValue : []);
    }
    return currentValue !== undefined && !Array.isArray(currentValue)
      ? new Set<string | number>([currentValue])
      : new Set<string | number>();
  }, [config.type, currentValue]);


  const filteredOptions = useMemo(() => {
    if (!search.trim()) return config.options;
    const query = search.toLowerCase();
    return config.options.filter((opt) =>
      opt.label.toLowerCase().includes(query),
    );
  }, [config.options, search]);

  function handleToggle(optValue: string | number) {
    if (config.type === 'multiple') {
      const next = new Set(selectedValues);
      if (next.has(optValue)) {
        next.delete(optValue);
      } else {
        next.add(optValue);
      }
      const arr = Array.from(next);
      onSelect(arr.length > 0 ? arr : undefined);
    } else {
      if (selectedValues.has(optValue)) {
        onSelect(undefined);
      } else {
        onSelect(optValue);
      }
      setOpen(false);
    }
  }

  const selectedCount = selectedValues.size;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 border-dashed gap-1.5 text-xs font-normal"
        >
          <Plus className="size-3 text-muted-foreground" />
          <span>{config.label}</span>
          {selectedCount > 0 ? (
            <span className="flex size-4 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
              {selectedCount}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        <div className="flex flex-col gap-1">
          <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
            Filter by {config.label.toLowerCase()}
          </div>

          {config.options.length > 5 ? (
            <div className="relative px-1 pb-1">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 size-3 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                className="h-7 pl-7 text-xs"
              />
            </div>
          ) : null}

          <ScrollArea className="max-h-56">
            <div className="flex flex-col gap-0.5 p-0.5">
              {filteredOptions.length === 0 ? (
                <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                  No options found
                </div>
              ) : (
                filteredOptions.map((opt) => {
                  const isChecked = selectedValues.has(opt.value);
                  const Icon = opt.icon;
                  return (
                    <button
                      key={String(opt.value)}
                      type="button"
                      onClick={() => handleToggle(opt.value)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground"
                    >
                      {config.type === 'multiple' ? (
                        <Checkbox
                          checked={isChecked}
                          tabIndex={-1}
                          className="pointer-events-none"
                        />
                      ) : (
                        <span className="flex size-4 items-center justify-center">
                          {isChecked ? <Check className="size-3" /> : null}
                        </span>
                      )}
                      {Icon ? <Icon className="size-3.5 text-muted-foreground" /> : null}
                      <span className="truncate">{opt.label}</span>
                    </button>
                  );
                })
              )}
            </div>
          </ScrollArea>

          {selectedCount > 0 ? (
            <div className="border-t border-border/50 pt-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-full justify-center text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  onSelect(undefined);
                  if (config.type === 'single') {
                    setOpen(false);
                  }
                }}
              >
                Clear filter
              </Button>
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Reusable table filter bar.
 * As soon as filters are selected, they appear as badges on the left.
 * Allows choosing multiple values or single values based on the filter configuration.
 */
export function TableFilterBar<
  TFilters extends TableFilterValues = TableFilterValues,
>({
  filters,
  values,
  onValuesChange,
  className,
  actions,
}: TableFilterBarProps<TFilters>) {
  // Extract all active badges to display on the left
  const activeBadges = useMemo<ActiveBadge[]>(() => {
    const list: ActiveBadge[] = [];

    for (const config of filters) {
      const val = values[config.id];
      if (val === undefined) continue;

      if (config.type === 'multiple' && Array.isArray(val)) {
        for (const item of val) {
          const opt = config.options.find((o) => o.value === item);
          const label = opt ? opt.label : String(item);
          list.push({
            id: `${config.id}-${item}`,
            filterId: config.id,
            filterLabel: config.label,
            optionLabel: label,
            onRemove: () => {
              const currentArr = Array.isArray(values[config.id])
                ? (values[config.id] as (string | number)[])
                : [];
              const nextArr = currentArr.filter((x) => x !== item);
              onValuesChange({
                ...values,
                [config.id]: nextArr.length > 0 ? nextArr : undefined,
              });
            },
          });
        }
      } else if (config.type === 'single' && val !== undefined) {
        const opt = config.options.find((o) => o.value === val);
        const label = opt ? opt.label : String(val);
        list.push({
          id: `${config.id}-${val}`,
          filterId: config.id,
          filterLabel: config.label,
          optionLabel: label,
          onRemove: () => {
            onValuesChange({
              ...values,
              [config.id]: undefined,
            });
          },
        });
      }
    }

    return list;
  }, [filters, values, onValuesChange]);

  function handleClearAll() {
    const cleared: Partial<TFilters> = {};
    for (const config of filters) {
      cleared[config.id as keyof TFilters] = undefined as any;
    }
    onValuesChange({
      ...values,
      ...cleared,
    });
  }

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2.5 ${
        className ?? ''
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {/* Active Filter Badges on the Left */}
        {activeBadges.map((badge) => (
          <Badge
            key={badge.id}
            variant="secondary"
            className="flex items-center gap-1.5 py-1 pl-2.5 pr-1 text-xs font-normal"
          >
            <span>
              {badge.filterLabel}:{' '}
              <strong className="font-medium">{badge.optionLabel}</strong>
            </span>
            <button
              type="button"
              onClick={badge.onRemove}
              className="flex size-3.5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={`Remove filter ${badge.filterLabel} ${badge.optionLabel}`}
            >
              <X className="size-2.5" />
            </button>
          </Badge>
        ))}

        {/* Clear All action if badges exist */}
        {activeBadges.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={handleClearAll}
            className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            Clear all
          </Button>
        ) : null}

        {/* Filter Popover triggers */}
        <div className="flex items-center gap-2">
          {filters.map((config) => (
            <FilterPopover
              key={config.id}
              config={config}
              currentValue={values[config.id]}
              onSelect={(nextVal) => {
                onValuesChange({
                  ...values,
                  [config.id]: nextVal,
                });
              }}
            />
          ))}
        </div>
      </div>

      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
