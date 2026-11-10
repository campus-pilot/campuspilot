'use client';

import type { DataMigrationRunDto } from '@campuspilot/api/routers/system-admin/data-migration/data-migration.dto';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Button } from '@campuspilot/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@campuspilot/ui/components/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@campuspilot/ui/components/table';

import { orpc } from '@/lib/orpc';

/** Pages of a run's skipped report, keyed by the run so each run loads its own. */
function useSkippedItems(runId: string) {
  return useInfiniteQuery(
    orpc.systemAdmin.listDataMigrationSkippedItems.infiniteOptions({
      input: (after: string | undefined) => ({ runId, after, limit: 50 }),
      initialPageParam: undefined,
      getNextPageParam: (page) => page.nextAfter ?? undefined,
    }),
  );
}

function SkippedItemsTable({ runId }: { runId: string }) {
  const query = useSkippedItems(runId);
  if (query.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (query.isError) return <p className="text-sm text-destructive">{query.error.message}</p>;
  const items = query.data.pages.flatMap((page) => page.items);
  return (
    <div className="flex flex-col gap-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead>Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.itemKey}>
              <TableCell className="font-mono text-xs">{item.itemKey}</TableCell>
              <TableCell>{item.reason}</TableCell>
              <TableCell className="font-mono text-xs">
                {Object.entries(item.detail ?? {}).map(([key, value]) => `${key}: ${value}`).join(', ')}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {query.hasNextPage ? (
        <Button variant="outline" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
          {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      ) : null}
    </div>
  );
}

/** The skipped report of one run. */
export function DataMigrationSkippedDialog({ run, onOpenChange }: {
  run: DataMigrationRunDto | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={run !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Items needing attention</DialogTitle>
          <DialogDescription>Items this run could not fully migrate. Some may still have been partly changed (counted under Changed); each needs attention in the app.</DialogDescription>
        </DialogHeader>
        {run ? <SkippedItemsTable key={run.id} runId={run.id} /> : null}
      </DialogContent>
    </Dialog>
  );
}
