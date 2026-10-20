"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import { SCHOOL_ACTIONS } from "@campuspilot/api/routers/authorization/authorization.dto";
import { billingRunDtoSchema } from "@campuspilot/api/routers/school/billing/billing.dto";
import { paymentListOutputSchema } from "@campuspilot/api/routers/school/billing/ledger.dto";
import { DataTable, type DataTableColumnDef } from "@campuspilot/components/data-grid";
import { FinanceSummaryCards, formatBasisPoints, formatFinanceInstant, formatMinor } from "@campuspilot/components/finance";
import { Badge } from "@campuspilot/ui/components/badge";
import { Button } from "@campuspilot/ui/components/button";
import { ExternalLink, Plus } from "lucide-react";
import { RequirePermissions } from "@/components/require-permissions";
import { orpc } from "@/lib/orpc";
import { BillingRunDialog } from "./billing-run-dialog";
import { FinanceError, FinanceLoading, PageSection } from "./finance-ui";

type BillingRun = z.infer<typeof billingRunDtoSchema>;
type Payment = z.infer<typeof paymentListOutputSchema>["items"][number];

function BillingRunAction({ schoolId, sessionId }: { schoolId: string; sessionId: string }) {
  const [open, setOpen] = useState(false);
  const financeQuery = useQuery(orpc.school.getSessionFinance.queryOptions({ input: { schoolId, sessionId } }));
  if (financeQuery.isPending) return <Button type="button" disabled><Plus aria-hidden />Create billing run</Button>;
  if (financeQuery.isError || !financeQuery.data) return null;
  const finance = financeQuery.data;
  const elements = Object.entries(finance.financeConfig?.elements ?? {}).filter(([, element]) => element.requiredAtLevel === "bill_generation").map(([slug, element]) => ({ slug, name: element.name, scopes: element.scopes }));
  return <><Button type="button" disabled={!finance.configurationReadiness.readyForBilling} onClick={() => setOpen(true)}><Plus aria-hidden />Create billing run</Button>{open && finance.financeConfig?.currency && finance.financeConfig.timeZone ? <BillingRunDialog open schoolId={schoolId} sessionId={sessionId} currency={finance.financeConfig.currency} timeZone={finance.financeConfig.timeZone} runtimeElements={elements} onOpenChange={setOpen} /> : null}</>;
}

function RecentRuns({ schoolId, sessionId }: { schoolId: string; sessionId: string }) {
  const query = useQuery(orpc.school.listBillingRuns.queryOptions({ input: { schoolId, page: 1, limit: 5, filters: { sessionId }, orderBy: { field: "recordedAt", direction: "desc" } } }));
  if (query.isPending) return <FinanceLoading rows={3} />;
  if (query.isError) return <FinanceError title="Unable to load recent billing runs" error={query.error} />;
  const base = `/school/${encodeURIComponent(schoolId)}/sessions/${encodeURIComponent(sessionId)}/billing/runs`;
  const columns: DataTableColumnDef<BillingRun>[] = [
    { accessorKey: "periodKey", header: "Period", cell: ({ row }) => <span className="font-medium">{row.original.periodKey}</span> },
    { accessorKey: "kind", header: "Type", cell: ({ row }) => <span className="capitalize">{row.original.kind}</span> },
    { accessorKey: "billCount", header: "Bills" },
    { accessorKey: "totalAmountMinor", header: "Total", cell: ({ row }) => formatMinor(row.original.totalAmountMinor, row.original.currency) },
    { accessorKey: "recordedAt", header: "Posted", cell: ({ row }) => formatFinanceInstant(row.original.recordedAt, row.original.timeZone) },
    { id: "actions", header: "", cell: ({ row }) => <Button asChild variant="ghost" size="sm"><Link href={`${base}/${encodeURIComponent(row.original.id)}`}>View<span className="sr-only"> billing run {row.original.periodKey}</span><ExternalLink aria-hidden /></Link></Button> },
  ];
  return <PageSection title="Recent billing runs" description="The five most recently posted run commands."><DataTable ariaLabel="Recent billing runs" columns={columns} data={query.data.items} getRowId={(run) => run.id} /></PageSection>;
}

function RecentPayments({ schoolId, sessionId }: { schoolId: string; sessionId: string }) {
  const query = useQuery(orpc.school.listPayments.queryOptions({ input: { schoolId, page: 1, limit: 5, filters: { sessionId } } }));
  if (query.isPending) return <FinanceLoading rows={3} />;
  if (query.isError) return <FinanceError title="Unable to load recent payments" error={query.error} />;
  const href = `/school/${encodeURIComponent(schoolId)}/sessions/${encodeURIComponent(sessionId)}/billing/payments`;
  const columns: DataTableColumnDef<Payment>[] = [
    { accessorKey: "receiptNumber", header: "Receipt", cell: ({ row }) => <span className="font-mono text-xs">{row.original.receiptNumber}</span> },
    { accessorKey: "admissionName", header: "Admission", cell: ({ row }) => <span className="font-medium">{row.original.admissionName}</span> },
    { accessorKey: "method", header: "Method", cell: ({ row }) => <span className="capitalize">{row.original.method.replaceAll("_", " ")}</span> },
    { accessorKey: "amountMinor", header: "Amount", cell: ({ row }) => formatMinor(row.original.amountMinor, row.original.currency) },
    { accessorKey: "status", header: "Status", cell: ({ row }) => <Badge variant="outline" className="capitalize">{row.original.status.replaceAll("_", " ")}</Badge> },
    { id: "actions", header: "", cell: ({ row }) => <Button asChild variant="ghost" size="sm"><Link href={`${href}?paymentId=${encodeURIComponent(row.original.id)}&admissionId=${encodeURIComponent(row.original.admissionId)}`}>View<span className="sr-only"> payment {row.original.receiptNumber}</span><ExternalLink aria-hidden /></Link></Button> },
  ];
  return <PageSection title="Recent payments" description="The five most recently recorded payments."><DataTable ariaLabel="Recent payments" columns={columns} data={query.data.items} getRowId={(payment) => payment.id} /></PageSection>;
}

export function BillingOverview({ schoolId, sessionId }: { schoolId: string; sessionId: string }) {
  const overviewQuery = useQuery(orpc.school.getSessionFinanceOverview.queryOptions({ input: { schoolId, sessionId } }));
  if (overviewQuery.isPending) return <FinanceLoading rows={4} />;
  if (overviewQuery.isError) return <FinanceError title="Unable to load billing overview" error={overviewQuery.error} />;
  const resource = { kind: "school" as const, schoolId };
  return <div className="flex min-w-0 flex-col gap-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Session overview</h2><p className="text-xs text-muted-foreground">Posted charges, cash, adjustments, refunds, and account balances for this academic session.</p></div><RequirePermissions permissions={[SCHOOL_ACTIONS.READ_SESSION_FINANCE, SCHOOL_ACTIONS.PREVIEW_BILLING_RUN, SCHOOL_ACTIONS.POST_BILLING_RUN].map((action) => ({ action, resource }))}><BillingRunAction schoolId={schoolId} sessionId={sessionId} /></RequirePermissions></div>{overviewQuery.data.currencies.length ? overviewQuery.data.currencies.map((summary) => <section key={summary.currency} className="flex flex-col gap-3"><div className="flex items-center gap-2"><h3 className="font-medium">{summary.currency}</h3>{overviewQuery.data.currencies.length > 1 ? <Badge variant="outline">Separate currency balance</Badge> : null}</div><FinanceSummaryCards items={[
    { label: "Billed", value: formatMinor(summary.billedMinor, summary.currency) },
    { label: "Net collected", value: formatMinor(summary.netCashMinor, summary.currency), detail: `${formatMinor(summary.refundMinor, summary.currency)} refunded` },
    { label: "Discounts", value: formatMinor(summary.discountMinor, summary.currency) },
    { label: "Waivers", value: formatMinor(summary.waiverMinor, summary.currency) },
    { label: "Write-offs", value: formatMinor(summary.writeOffMinor, summary.currency) },
    { label: "Credit corrections", value: formatMinor(summary.creditCorrectionMinor, summary.currency) },
    { label: "Debit corrections", value: formatMinor(summary.debitAdjustmentMinor, summary.currency) },
    { label: "Due", value: formatMinor(summary.dueMinor, summary.currency) },
    { label: "Credit", value: formatMinor(summary.creditMinor, summary.currency) },
    { label: "Collection rate", value: summary.collectionRateBasisPoints === null ? "—" : formatBasisPoints(summary.collectionRateBasisPoints), detail: "Net cash ÷ billed" },
  ]} /></section>) : <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No finance activity has been posted for this session.</p>}<RequirePermissions permissions={{ action: SCHOOL_ACTIONS.READ_BILLING_RUNS, resource }}><RecentRuns schoolId={schoolId} sessionId={sessionId} /></RequirePermissions><RequirePermissions permissions={{ action: SCHOOL_ACTIONS.READ_ADMISSION_LEDGER, resource }}><RecentPayments schoolId={schoolId} sessionId={sessionId} /></RequirePermissions></div>;
}
