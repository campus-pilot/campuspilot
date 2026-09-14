'use client';

import { Suspense, type ReactNode } from 'react';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type TableOptions,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { Button } from '@campuspilot/ui/components/button';
import { Skeleton } from '@campuspilot/ui/components/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@campuspilot/ui/components/table';

export type DataTableColumnDef<TData, TValue = unknown> = ColumnDef<
  TData,
  TValue
>;

export type DataTableProps<TData> = Omit<
  TableOptions<TData>,
  'getCoreRowModel'
> & {
  ariaLabel: string;
  emptyMessage?: string;
  showPagination?: boolean;
};

function SortIndicator({ direction }: { direction: false | 'asc' | 'desc' }) {
  if (direction === 'asc') return <ArrowUp aria-hidden className="size-3.5" />;
  if (direction === 'desc') return <ArrowDown aria-hidden className="size-3.5" />;
  return <ArrowUpDown aria-hidden className="size-3.5 text-muted-foreground" />;
}

/**
 * Renders any TanStack Table configuration with CampusPilot's shared table
 * chrome. Cell content, badges, links, and actions remain entirely controlled
 * by the caller's column definitions.
 */
export function DataTable<TData>({
  ariaLabel,
  emptyMessage = 'No results found.',
  showPagination = false,
  ...options
}: DataTableProps<TData>) {
  const table = useReactTable({
    ...options,
    getCoreRowModel: getCoreRowModel(),
  });
  const rows = table.getRowModel().rows;
  const { pageIndex, pageSize } = table.getState().pagination;
  const totalItems = table.options.rowCount ?? options.data.length;
  const totalPages = table.getPageCount();
  const firstItem = totalItems === 0 ? 0 : pageIndex * pageSize + 1;
  const lastItem = Math.min(firstItem + rows.length - 1, totalItems);

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table aria-label={ariaLabel}>
        <TableHeader className="bg-muted/40">
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id} colSpan={header.colSpan}>
                  {header.isPlaceholder ? null : header.column.getCanSort() ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="-ml-2 h-7 px-2"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                      <SortIndicator direction={header.column.getIsSorted()} />
                    </Button>
                  ) : (
                    flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length > 0 ? (
            rows.map((row) => (
              <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell
                colSpan={table.getVisibleLeafColumns().length}
                className="h-32 text-center text-muted-foreground"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {showPagination ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-3 py-2">
          <p className="text-xs text-muted-foreground">
            {totalItems === 0
              ? 'No results'
              : `${firstItem}–${lastItem} of ${totalItems}`}
          </p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Page {totalPages === 0 ? 0 : pageIndex + 1} of {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function DataTableSkeleton({
  columnCount,
  rowCount = 6,
}: {
  columnCount: number;
  rowCount?: number;
}) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table aria-label="Loading table">
        <TableHeader className="bg-muted/40">
          <TableRow>
            {Array.from({ length: columnCount }, (_, index) => (
              <TableHead key={index}>
                <Skeleton className="h-3.5 w-20" />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rowCount }, (_, rowIndex) => (
            <TableRow key={rowIndex}>
              {Array.from({ length: columnCount }, (_, columnIndex) => (
                <TableCell key={columnIndex}>
                  <Skeleton className="h-4 w-full max-w-32" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex items-center justify-between gap-3 border-t px-3 py-2">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-7 w-48" />
      </div>
    </div>
  );
}

/**
 * Keeps the loading treatment colocated with the shared table. Querying stays
 * in the consuming app, while any descendant that suspends gets a table-shaped
 * fallback automatically.
 */
export function DataTableSuspense({
  children,
  columnCount,
  rowCount,
}: {
  children: ReactNode;
  columnCount: number;
  rowCount?: number;
}) {
  return (
    <Suspense
      fallback={
        <DataTableSkeleton columnCount={columnCount} rowCount={rowCount} />
      }
    >
      {children}
    </Suspense>
  );
}
