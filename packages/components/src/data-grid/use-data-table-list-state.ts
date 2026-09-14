'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  functionalUpdate,
  type OnChangeFn,
  type PaginationState,
  type SortingState,
} from '@tanstack/react-table';

type OrderBy<TField extends string> = {
  field: TField;
  direction: 'asc' | 'desc';
};

export type DataTableListStateOptions<TField extends string, TFilters> = {
  defaultOrderBy: OrderBy<TField>;
  defaultFilters?: TFilters;
  pageSize?: number;
};

export type DataTableListController<TField extends string, TFilters> = {
  query: {
    searchQuery: string | undefined;
    filters: TFilters | undefined;
    orderBy: OrderBy<TField>;
    page: number;
    limit: number;
  };
  tableState: {
    pagination: PaginationState;
    sorting: SortingState;
  };
  onPaginationChange: OnChangeFn<PaginationState>;
  onSortingChange: OnChangeFn<SortingState>;
  onSearchChange: (searchQuery: string | undefined) => void;
  onFiltersChange: (filters: TFilters | undefined) => void;
};

/**
 * Adapts the app-wide page/limit/search/orderBy list contract to TanStack
 * Table's zero-based pagination and sorting state. Search, sort, and filter
 * changes always return to the first page so routes never request stale pages.
 */
export function useDataTableListState<
  TField extends string,
  TFilters = never,
>({
  defaultOrderBy,
  defaultFilters,
  pageSize = 20,
}: DataTableListStateOptions<TField, TFilters>): DataTableListController<
  TField,
  TFilters
> {
  const [searchQuery, setSearchQuery] = useState<string>();
  const [filters, setFilters] = useState<TFilters | undefined>(defaultFilters);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize,
  });
  const [sorting, setSorting] = useState<SortingState>([
    { id: defaultOrderBy.field, desc: defaultOrderBy.direction === 'desc' },
  ]);

  const onPaginationChange = useCallback<OnChangeFn<PaginationState>>(
    (updater) => setPagination((current) => functionalUpdate(updater, current)),
    [],
  );
  const onSortingChange = useCallback<OnChangeFn<SortingState>>((updater) => {
    setSorting((current) => functionalUpdate(updater, current).slice(0, 1));
    setPagination((current) => ({ ...current, pageIndex: 0 }));
  }, []);
  const onSearchChange = useCallback((nextSearchQuery: string | undefined) => {
    setSearchQuery(nextSearchQuery);
    setPagination((current) => ({ ...current, pageIndex: 0 }));
  }, []);
  const onFiltersChange = useCallback((nextFilters: TFilters | undefined) => {
    setFilters(nextFilters);
    setPagination((current) => ({ ...current, pageIndex: 0 }));
  }, []);

  const query = useMemo(() => {
    const activeSort = sorting[0];
    return {
      searchQuery,
      filters,
      orderBy: activeSort
        ? {
            field: activeSort.id as TField,
            direction: activeSort.desc ? ('desc' as const) : ('asc' as const),
          }
        : defaultOrderBy,
      page: pagination.pageIndex + 1,
      limit: pagination.pageSize,
    };
  }, [defaultOrderBy, filters, pagination, searchQuery, sorting]);

  return {
    query,
    tableState: { pagination, sorting },
    onPaginationChange,
    onSortingChange,
    onSearchChange,
    onFiltersChange,
  };
}
