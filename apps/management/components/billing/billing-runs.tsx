"use client";

import Link from "next/link";
import { useSuspenseQuery } from "@tanstack/react-query";
import type { z } from "zod";
import { billingRunDtoSchema } from "@campuspilot/api/routers/school/billing/billing.dto";
import { DataTable, DataTableSuspense, TableFilterBar, TableSearchBar, useDataTableListState, type DataTableColumnDef, type TableFilterConfig } from "@campuspilot/components/data-grid";
import { formatFinanceInstant, formatMinor } from "@campuspilot/components/finance";
import { Badge } from "@campuspilot/ui/components/badge";
import { Button } from "@campuspilot/ui/components/button";
import { ExternalLink } from "lucide-react";
import { orpc } from "@/lib/orpc";

type BillingRun = z.infer<typeof billingRunDtoSchema>;
type Filters = { kind?: "regular" | "supplemental"; periodKey?: string };

function BillingRunRows({ schoolId, sessionId, controller }: { schoolId: string; sessionId: string; controller: ReturnType<typeof useDataTableListState<"recordedAt" | "issueDate" | "periodKey", Filters>> }) {
  const { data } = useSuspenseQuery(orpc.school.listBillingRuns.queryOptions({ input: { schoolId, page: controller.query.page, limit: controller.query.limit, orderBy: controller.query.orderBy, filters: { sessionId, ...(controller.query.filters?.kind ? { kind: controller.query.filters.kind } : {}), ...(controller.query.searchQuery ? { periodKey: controller.query.searchQuery } : {}) } } }));
  const columns: DataTableColumnDef<BillingRun>[] = [
    { accessorKey: "periodKey", header: "Period", cell: ({ row }) => <div><p className="font-medium">{row.original.periodKey}</p><p className="text-xs text-muted-foreground">{row.original.periodStartDate} – {row.original.periodEndDate}</p></div> },
    { accessorKey: "kind", header: "Type", cell: ({ row }) => <Badge variant="outline" className="capitalize">{row.original.kind}</Badge> },
    { accessorKey: "issueDate", header: "Issue date" },
    { accessorKey: "billCount", header: "Bills" },
    { accessorKey: "totalAmountMinor", header: "Total", cell: ({ row }) => <span className="font-medium tabular-nums">{formatMinor(row.original.totalAmountMinor, row.original.currency)}</span> },
    { accessorKey: "recordedAt", header: "Posted", cell: ({ row }) => formatFinanceInstant(row.original.recordedAt, row.original.timeZone) },
    { id: "status", header: "Status", cell: ({ row }) => <Badge variant={row.original.fullyReversed ? "secondary" : "outline"}>{row.original.fullyReversed ? "Reversed" : row.original.status}</Badge> },
    { id: "actions", header: "", enableSorting: false, cell: ({ row }) => <Button asChild variant="ghost" size="sm"><Link href={`/school/${encodeURIComponent(schoolId)}/sessions/${encodeURIComponent(sessionId)}/billing/runs/${encodeURIComponent(row.original.id)}`}>View<span className="sr-only"> run {row.original.periodKey}</span><ExternalLink aria-hidden /></Link></Button> },
  ];
  return <DataTable ariaLabel="Billing runs" columns={columns} data={data.items} getRowId={(run) => run.id} manualPagination manualSorting onPaginationChange={controller.onPaginationChange} onSortingChange={controller.onSortingChange} pageCount={data.pagination.totalPages} rowCount={data.pagination.totalItems} showPagination state={controller.tableState} emptyMessage="No billing runs match this view." />;
}

export function BillingRuns({ schoolId, sessionId }: { schoolId: string; sessionId: string }) {
  const controller = useDataTableListState<"recordedAt" | "issueDate" | "periodKey", Filters>({ defaultOrderBy: { field: "recordedAt", direction: "desc" } });
  const filterConfig: TableFilterConfig<keyof Filters>[] = [{ id: "kind", label: "Run type", type: "single", options: [{ value: "regular", label: "Regular" }, { value: "supplemental", label: "Supplemental" }] }];
  return <section className="flex min-w-0 flex-col gap-4"><div><h2 className="text-lg font-semibold">Billing runs</h2><p className="text-xs text-muted-foreground">Review immutable batch commands, bills, and reversals.</p></div><div className="flex flex-wrap items-start justify-between gap-3"><TableSearchBar placeholder="Filter by exact period key…" onSearchChange={controller.onSearchChange} /><TableFilterBar filters={filterConfig} values={controller.query.filters ?? {}} onValuesChange={controller.onFiltersChange} /></div><DataTableSuspense key={JSON.stringify(controller.query)} columnCount={8}><BillingRunRows schoolId={schoolId} sessionId={sessionId} controller={controller} /></DataTableSuspense></section>;
}
