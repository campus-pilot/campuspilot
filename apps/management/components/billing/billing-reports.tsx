"use client";

import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { DataTable, TableFilterBar, TableSearchBar, type DataTableColumnDef, type TableFilterConfig } from "@campuspilot/components/data-grid";
import { FinanceSummaryCards, formatMinor } from "@campuspilot/components/finance";
import { Badge } from "@campuspilot/ui/components/badge";
import { orpc } from "@/lib/orpc";
import { FieldErrors, FinanceError, FinanceLoading, SimplePagination } from "./finance-ui";

const reportSchema = z.object({ report: z.enum(["overview", "collection", "fee", "class"]), search: z.string().max(200) });
type Report = z.infer<typeof reportSchema>["report"];

function CollectionReport({ schoolId, sessionId, search }: { schoolId: string; sessionId: string; search?: string }) {
  const [page, setPage] = useState(1);
  const query = useQuery(orpc.school.getCollectionRegister.queryOptions({ input: { schoolId, page, limit: 20, filters: { sessionId, ...(search ? { search } : {}) } } }));
  if (query.isPending) return <FinanceLoading />; if (query.isError) return <FinanceError title="Unable to load collection report" error={query.error} />;
  const columns: DataTableColumnDef<(typeof query.data.items)[number]>[] = [
    { accessorKey: "documentNumber", header: "Document", enableSorting: false }, { accessorKey: "admissionName", header: "Admission", enableSorting: false }, { accessorKey: "kind", header: "Kind", enableSorting: false }, { accessorKey: "method", header: "Method", enableSorting: false }, { accessorKey: "amountMinor", header: "Amount", enableSorting: false, cell: ({ row }) => formatMinor(row.original.amountMinor, row.original.currency) }, { accessorKey: "reversed", header: "Status", enableSorting: false, cell: ({ row }) => <Badge variant={row.original.reversed ? "secondary" : "outline"}>{row.original.reversed ? "Reversed" : "Active"}</Badge> }, { accessorKey: "reference", header: "Reference", enableSorting: false },
  ];
  return <div className="flex flex-col gap-3"><DataTable ariaLabel="Collection report" columns={columns} data={query.data.items} getRowId={(item) => item.ledgerEntryId} /><SimplePagination currentPage={query.data.pagination.currentPage} totalPages={query.data.pagination.totalPages} onPageChange={setPage} /></div>;
}

function FeeReport({ schoolId, sessionId, search }: { schoolId: string; sessionId: string; search?: string }) {
  const [page, setPage] = useState(1);
  const query = useQuery(orpc.school.getFeeElementFinanceReport.queryOptions({ input: { schoolId, page, limit: 20, filters: { sessionId, ...(search ? { search } : {}) } } }));
  if (query.isPending) return <FinanceLoading />; if (query.isError) return <FinanceError title="Unable to load fee report" error={query.error} />;
  const columns: DataTableColumnDef<(typeof query.data.items)[number]>[] = [
    { accessorKey: "feeElementName", header: "Fee element", enableSorting: false }, { accessorKey: "billCount", header: "Bills", enableSorting: false }, { accessorKey: "billedMinor", header: "Billed", enableSorting: false, cell: ({ row }) => formatMinor(row.original.billedMinor, row.original.currency) }, { accessorKey: "creditAdjustmentMinor", header: "Credits", enableSorting: false, cell: ({ row }) => formatMinor(row.original.creditAdjustmentMinor, row.original.currency) }, { accessorKey: "debitAdjustmentMinor", header: "Debits", enableSorting: false, cell: ({ row }) => formatMinor(row.original.debitAdjustmentMinor, row.original.currency) }, { accessorKey: "netChargeMinor", header: "Net charge", enableSorting: false, cell: ({ row }) => formatMinor(row.original.netChargeMinor, row.original.currency) },
  ];
  return <div className="flex flex-col gap-3"><DataTable ariaLabel="Fee element report" columns={columns} data={query.data.items} getRowId={(item) => `${item.currency}-${item.feeElementSlug}`} /><SimplePagination currentPage={query.data.pagination.currentPage} totalPages={query.data.pagination.totalPages} onPageChange={setPage} /></div>;
}

function ClassReport({ schoolId, sessionId, search }: { schoolId: string; sessionId: string; search?: string }) {
  const [page, setPage] = useState(1);
  const query = useQuery(orpc.school.getClassFinanceSnapshot.queryOptions({ input: { schoolId, page, limit: 20, filters: { sessionId, ...(search ? { search } : {}) } } }));
  if (query.isPending) return <FinanceLoading />; if (query.isError) return <FinanceError title="Unable to load class report" error={query.error} />;
  const columns: DataTableColumnDef<(typeof query.data.items)[number]>[] = [
    { accessorKey: "classLabel", header: "Class", enableSorting: false, cell: ({ row }) => row.original.classLabel ?? "Historical / unplaced" }, { accessorKey: "billCount", header: "Bills", enableSorting: false }, { accessorKey: "billedMinor", header: "Billed", enableSorting: false, cell: ({ row }) => formatMinor(row.original.billedMinor, row.original.currency) }, { accessorKey: "allocatedMinor", header: "Allocated", enableSorting: false, cell: ({ row }) => formatMinor(row.original.allocatedMinor, row.original.currency) }, { accessorKey: "outstandingMinor", header: "Outstanding", enableSorting: false, cell: ({ row }) => formatMinor(row.original.outstandingMinor, row.original.currency) },
  ];
  return <div className="flex flex-col gap-3"><DataTable ariaLabel="Class finance report" columns={columns} data={query.data.items} getRowId={(item) => `${item.currency}-${item.classId ?? item.classLabel ?? "unplaced"}`} /><SimplePagination currentPage={query.data.pagination.currentPage} totalPages={query.data.pagination.totalPages} onPageChange={setPage} /></div>;
}

function OverviewReport({ schoolId, sessionId }: { schoolId: string; sessionId: string }) {
  const query = useQuery(orpc.school.getSessionFinanceOverview.queryOptions({ input: { schoolId, sessionId } }));
  if (query.isPending) return <FinanceLoading />; if (query.isError) return <FinanceError title="Unable to load overview report" error={query.error} />;
  return <div className="flex flex-col gap-4">{query.data.currencies.map((item) => <FinanceSummaryCards key={item.currency} items={[{ label: `Billed (${item.currency})`, value: formatMinor(item.billedMinor, item.currency) }, { label: "Payments", value: formatMinor(item.paymentMinor, item.currency) }, { label: "Refunds", value: formatMinor(item.refundMinor, item.currency) }, { label: "Discounts", value: formatMinor(item.discountMinor, item.currency) }, { label: "Waivers", value: formatMinor(item.waiverMinor, item.currency) }, { label: "Write-offs", value: formatMinor(item.writeOffMinor, item.currency) }, { label: "Credit corrections", value: formatMinor(item.creditCorrectionMinor, item.currency) }, { label: "Debit corrections", value: formatMinor(item.debitAdjustmentMinor, item.currency) }, { label: "Due", value: formatMinor(item.dueMinor, item.currency) }, { label: "Credit", value: formatMinor(item.creditMinor, item.currency) }]} />)}</div>;
}

export function BillingReports({ schoolId, sessionId }: { schoolId: string; sessionId: string }) {
  const form = useForm({ defaultValues: { report: "overview" as Report, search: "" }, validators: { onChange: reportSchema } });
  const filters: TableFilterConfig<"report">[] = [{ id: "report", label: "Report", type: "single", options: [{ value: "overview", label: "Overview" }, { value: "collection", label: "Collection" }, { value: "fee", label: "Fee elements" }, { value: "class", label: "Classes" }] }];
  return <section className="flex min-w-0 flex-col gap-4"><div><h2 className="text-lg font-semibold">Finance reports</h2><p className="text-xs text-muted-foreground">Session overview, cash collection, fee-element, and class snapshots built from posted ledger facts.</p></div><div className="flex flex-wrap items-start justify-between gap-3"><form.Field name="search">{(field) => <div><TableSearchBar placeholder="Search the selected report…" onSearchChange={(value) => field.handleChange(value ?? "")} /><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field><form.Field name="report">{(field) => <div><TableFilterBar filters={filters} values={{ report: field.state.value }} onValuesChange={(values) => field.handleChange((values.report ?? "overview") as Report)} /><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field></div><form.Subscribe selector={(state) => state.values}>{({ report, search }) => report === "overview" ? <OverviewReport schoolId={schoolId} sessionId={sessionId} /> : report === "collection" ? <CollectionReport key={search} schoolId={schoolId} sessionId={sessionId} search={search || undefined} /> : report === "fee" ? <FeeReport key={search} schoolId={schoolId} sessionId={sessionId} search={search || undefined} /> : <ClassReport key={search} schoolId={schoolId} sessionId={sessionId} search={search || undefined} />}</form.Subscribe></section>;
}
