"use client";

import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useQueries, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { SCHOOL_ACTIONS } from "@campuspilot/api/routers/authorization/authorization.dto";
import {
  FinanceLedgerTable,
  FinanceMonthlyChart,
  FinanceSummaryCards,
  formatFinanceInstant,
  formatMinor,
  reversalActionForEntry,
  type FinanceLedgerRow,
} from "@campuspilot/components/finance";
import { Badge } from "@campuspilot/ui/components/badge";
import { Button } from "@campuspilot/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@campuspilot/ui/components/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@campuspilot/ui/components/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@campuspilot/ui/components/tabs";
import {
  HandCoins,
  Percent,
  Plus,
  ReceiptText,
  RotateCcw,
  Undo2,
} from "lucide-react";
import { orpc } from "@/lib/orpc";
import { RequirePermissions } from "@/components/require-permissions";
import { useSchoolSessions } from "@/components/session-selection";
import {
  AdjustmentDialog,
  ManualBillDialog,
  PaymentDialog,
  RefundDialog,
  ReversalDialog,
  type FinanceSessionOption,
} from "./admission-finance-dialogs";
import { FinanceError, FinanceLoading, SimplePagination } from "./finance-ui";
import {
  FinanceDocumentAction,
  StatementDocumentDialog,
  type StatementSession,
} from "./finance-document-action";

type ActionDialog =
  | "manual"
  | "payment"
  | "adjustment"
  | "refund"
  | "reversal"
  | "statement"
  | null;
type LedgerEntry = {
  id: string;
  sessionId: string;
  type: string;
  direction: "debit" | "credit";
  amountMinor: string;
  currency: string;
  timeZone: string | null;
  effectiveAt: Date;
  recordedBy: string;
  runningBalanceMinor: string;
  reversalOfEntryId: string | null;
  reversed: boolean;
  detail: Record<string, unknown> | null;
  sequence: string;
};
type LedgerSession = {
  id: string;
  label: string;
  startYear: number;
  endYear: number;
};

function detailString(detail: Record<string, unknown> | null, key: string) {
  const value = detail?.[key];
  return typeof value === "string" ? value : undefined;
}
function entryReference(entry: LedgerEntry) {
  return (
    detailString(entry.detail, "billNumber") ??
    detailString(entry.detail, "receiptNumber") ??
    detailString(entry.detail, "refundNumber") ??
    entry.reversalOfEntryId ??
    `#${entry.sequence}`
  );
}
function financeInstantLabel(value: Date, timeZone: string | null) {
  return timeZone
    ? formatFinanceInstant(value, timeZone)
    : "Timezone unavailable";
}

function OperationMetadata({
  detail,
}: {
  detail: Record<string, unknown> | null;
}) {
  const keys = [
    "receiptNumber",
    "refundNumber",
    "method",
    "externalReference",
    "reasonCode",
    "reasonNote",
    "reason",
  ];
  const rows = keys.flatMap((key) => {
    const value = detail?.[key];
    return typeof value === "string" && value ? [{ key, value }] : [];
  });
  if (!rows.length) return null;
  return (
    <dl className="grid gap-2 rounded-xl border p-3 sm:grid-cols-2">
      {rows.map(({ key, value }) => (
        <div key={key}>
          <dt className="text-xs capitalize text-muted-foreground">
            {key.replaceAll(/([A-Z])/g, " $1")}
          </dt>
          <dd className="text-sm">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function BillDetailPanel({
  schoolId,
  admissionId,
  billId,
}: {
  schoolId: string;
  admissionId: string;
  billId: string;
}) {
  const [adjustmentPage, setAdjustmentPage] = useState(1);
  const query = useQuery(
    orpc.school.getAdmissionBill.queryOptions({
      input: {
        schoolId,
        admissionId,
        billId,
        adjustmentPage,
        adjustmentLimit: 10,
      },
    }),
  );
  if (query.isPending) return <FinanceLoading />;
  if (query.isError)
    return <FinanceError title="Unable to load bill" error={query.error} />;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <p className="text-xs text-muted-foreground">Related bill</p>
          <p className="font-mono">{query.data.billNumber}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Issue date</p>
          <p>{query.data.issueDate}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Net charge</p>
          <p>{formatMinor(query.data.netAmountMinor, query.data.currency)}</p>
        </div>
      </div>
      {query.data.manualReason ? (
        <div className="rounded-xl border p-3">
          <p className="text-xs text-muted-foreground">Manual charge reason</p>
          <p className="text-sm">{query.data.manualReason}</p>
        </div>
      ) : null}
      <section>
        <h3 className="mb-2 text-sm font-medium">Line snapshots</h3>
        {query.data.lines.map((line) => (
          <div
            key={line.id}
            className="flex items-start justify-between gap-3 border-t py-2"
          >
            <div>
              <p>{line.feeElementName}</p>
              <p className="text-xs text-muted-foreground">
                {line.pricingSourceKind.replaceAll("_", " ")}
              </p>
            </div>
            <span>{formatMinor(line.amountMinor, line.currency)}</span>
          </div>
        ))}
      </section>
      <section>
        <h3 className="text-sm font-medium">Adjustments</h3>
        {query.data.adjustments.items.map((item) => (
          <div
            key={item.id}
            className="flex justify-between gap-3 border-t py-2 text-sm"
          >
            <span className="flex items-center gap-2 capitalize">
              {item.kind.replaceAll("_", " ")}
              {item.reversed ? (
                <Badge variant="secondary">Reversed</Badge>
              ) : null}
            </span>
            <span>{formatMinor(item.amountMinor, item.currency)}</span>
          </div>
        ))}
        <SimplePagination
          currentPage={query.data.adjustments.pagination.currentPage}
          totalPages={query.data.adjustments.pagination.totalPages}
          onPageChange={setAdjustmentPage}
        />
      </section>
      <FinanceDocumentAction schoolId={schoolId} source={{ documentType: "bill", sessionId: query.data.sessionId, billIds: [query.data.id] }} label="Generate bill PDF" />
    </div>
  );
}

function PaymentDetailPanel({
  schoolId,
  admissionId,
  paymentId,
}: {
  schoolId: string;
  admissionId: string;
  paymentId: string;
}) {
  const [refundPage, setRefundPage] = useState(1);
  const query = useQuery(
    orpc.school.getPayment.queryOptions({
      input: {
        schoolId,
        admissionId,
        paymentId,
        refundPage,
        refundLimit: 10,
      },
    }),
  );
  if (query.isPending) return <FinanceLoading />;
  if (query.isError)
    return <FinanceError title="Unable to load payment" error={query.error} />;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs text-muted-foreground">Related receipt</p>
        <p className="font-mono">{query.data.receiptNumber}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div><p className="text-xs text-muted-foreground">Amount received</p><p>{formatMinor(query.data.amountMinor, query.data.currency)}</p></div>
        <div><p className="text-xs text-muted-foreground">Refunded</p><p>{formatMinor(query.data.refundedMinor, query.data.currency)}</p></div>
        <div><p className="text-xs text-muted-foreground">Refundable</p><p>{formatMinor(query.data.refundableMinor, query.data.currency)}</p></div>
      </div>
      <p className="text-sm text-muted-foreground">This payment is an admission account credit and is not assigned to an individual bill.</p>
      <section>
        <h3 className="text-sm font-medium">Refunds</h3>
        {query.data.refunds.items.map((item) => (
          <div
            key={item.id}
            className="flex justify-between gap-3 border-t py-2 text-sm"
          >
            <span className="flex items-center gap-2">
              {item.refundNumber}
              {item.reversed ? (
                <Badge variant="secondary">Reversed</Badge>
              ) : null}
            </span>
            <span>{formatMinor(item.amountMinor, item.currency)}</span>
          </div>
        ))}
        <SimplePagination
          currentPage={query.data.refunds.pagination.currentPage}
          totalPages={query.data.refunds.pagination.totalPages}
          onPageChange={setRefundPage}
        />
      </section>
      <FinanceDocumentAction schoolId={schoolId} source={{ documentType: "receipt", sessionId: query.data.sessionId, transactions: [{ kind: "payment", id: query.data.id }] }} label="Generate receipt PDF" />
    </div>
  );
}

function LedgerEntryDetail({
  schoolId,
  admissionId,
  entry,
  onClose,
  onReverse,
}: {
  schoolId: string;
  admissionId: string;
  entry: LedgerEntry;
  onClose: () => void;
  onReverse?: () => void;
}) {
  const billId = detailString(entry.detail, "billId");
  const paymentId = detailString(entry.detail, "paymentId");
  const reversalPermission =
    reversalActionForEntry(entry.type) === "bill"
      ? SCHOOL_ACTIONS.REVERSE_BILL
      : SCHOOL_ACTIONS.REVERSE_LEDGER_ENTRY;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="capitalize">
            {entry.type.replaceAll("_", " ")}
          </DialogTitle>
          <DialogDescription>
            {entryReference(entry)} ·{" "}
            {formatMinor(entry.amountMinor, entry.currency)}
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-xl border p-3">
          <p className="text-xs text-muted-foreground">Selected operation</p>
          <p className="flex items-center gap-2 font-medium capitalize">
            {entry.type.replaceAll("_", " ")}
            {entry.reversed ? (
              <Badge variant="secondary">Reversed</Badge>
            ) : null}
          </p>
          <p className="text-sm">
            {formatMinor(entry.amountMinor, entry.currency)} ·{" "}
            {financeInstantLabel(entry.effectiveAt, entry.timeZone)}
          </p>
        </div>
        <OperationMetadata detail={entry.detail} />
        {billId ? (
          <BillDetailPanel
            schoolId={schoolId}
            admissionId={admissionId}
            billId={billId}
          />
        ) : paymentId ? (
          <PaymentDetailPanel
            schoolId={schoolId}
            admissionId={admissionId}
            paymentId={paymentId}
          />
        ) : (
          <pre className="max-h-72 overflow-auto rounded-xl bg-muted p-3 text-xs">
            {JSON.stringify(entry.detail, null, 2)}
          </pre>
        )}
        <DialogFooter>
          {onReverse ? (
            <RequirePermissions
              permissions={{
                action: reversalPermission,
                resource: { kind: "school", schoolId },
              }}
            >
              <Button
                type="button"
                variant="destructive"
                disabled={entry.type === "reversal" || entry.reversed}
                onClick={onReverse}
              >
                <RotateCcw aria-hidden />
                Reverse
              </Button>
            </RequirePermissions>
          ) : null}
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdmissionFinanceActions({
  schoolId,
  admissionId,
  registered,
  financeSessions,
  statementSessions,
  defaultSessionId,
  selectedEntry,
  dialog,
  onDialogChange,
}: {
  schoolId: string;
  admissionId: string;
  registered: boolean;
  financeSessions: FinanceSessionOption[];
  statementSessions: StatementSession[];
  defaultSessionId: string;
  selectedEntry?: LedgerEntry;
  dialog: ActionDialog;
  onDialogChange: (dialog: ActionDialog) => void;
}) {
  const sessionDefault = financeSessions.some(
    ({ id }) => id === defaultSessionId,
  )
    ? defaultSessionId
    : (financeSessions[0]?.id ?? "");
  const statementSessionDefault = statementSessions.some(
    ({ id }) => id === defaultSessionId,
  )
    ? defaultSessionId
    : (statementSessions[0]?.id ?? "");
  const defaultStatementSession = statementSessions.find(
    ({ id }) => id === statementSessionDefault,
  );
  /** Only an authoritative transition for the dialog's resolved default
   * session remounts its form. Updates to unrelated sessions must preserve a
   * person's current session and date selection. */
  const statementDialogRevision =
    defaultStatementSession?.status === "ready"
      ? `${defaultStatementSession.id}:ready:${defaultStatementSession.currency}:${defaultStatementSession.timeZone}:${defaultStatementSession.startYear}:${defaultStatementSession.endYear}:${defaultStatementSession.cycleStartMonth}`
      : `${defaultStatementSession?.id ?? "none"}:${defaultStatementSession?.status ?? "missing"}`;
  const entry = selectedEntry
    ? {
        id: selectedEntry.id,
        sessionId: selectedEntry.sessionId,
        amountMinor: selectedEntry.amountMinor,
        currency: selectedEntry.currency,
        reference: entryReference(selectedEntry),
        type: selectedEntry.type,
        billId:
          selectedEntry.type === "bill"
            ? detailString(selectedEntry.detail, "billId")
            : undefined,
      }
    : {
        id: "",
        sessionId: sessionDefault,
        amountMinor: "0",
        currency: financeSessions[0]?.currency ?? "",
        reference: "Unavailable",
        type: "reversal",
      };
  const baseProps = {
    schoolId,
    admissionId,
    sessions: financeSessions,
    defaultSessionId: sessionDefault,
    onClose: () => onDialogChange(null),
    entry,
  };
  const actionsDisabled = financeSessions.length === 0;
  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {registered ? (
          <RequirePermissions
            permissions={{
              action: SCHOOL_ACTIONS.CREATE_MANUAL_BILL,
              resource: { kind: "school", schoolId },
            }}
          >
            <Button
              type="button"
              variant="outline"
              disabled={actionsDisabled}
              onClick={() => onDialogChange("manual")}
            >
              <Plus aria-hidden />
              Manual bill
            </Button>
          </RequirePermissions>
        ) : null}
        <RequirePermissions
          permissions={{
            action: SCHOOL_ACTIONS.RECORD_PAYMENT,
            resource: { kind: "school", schoolId },
          }}
        >
          <Button
            type="button"
            disabled={actionsDisabled}
            onClick={() => onDialogChange("payment")}
          >
            <HandCoins aria-hidden />
            Record payment
          </Button>
        </RequirePermissions>
        <RequirePermissions
          permissions={{
            action: SCHOOL_ACTIONS.RECORD_FINANCE_ADJUSTMENT,
            resource: { kind: "school", schoolId },
          }}
        >
          <Button
            type="button"
            variant="outline"
            disabled={actionsDisabled}
            onClick={() => onDialogChange("adjustment")}
          >
            <Percent aria-hidden />
            Adjustment
          </Button>
        </RequirePermissions>
        <RequirePermissions
          permissions={{
            action: SCHOOL_ACTIONS.RECORD_REFUND,
            resource: { kind: "school", schoolId },
          }}
        >
          <Button
            type="button"
            variant="outline"
            disabled={actionsDisabled}
            onClick={() => onDialogChange("refund")}
          >
            <Undo2 aria-hidden />
            Refund
          </Button>
        </RequirePermissions>
        <RequirePermissions
          permissions={[
            {
              action: SCHOOL_ACTIONS.GENERATE_FINANCE_DOCUMENTS,
              resource: { kind: "school", schoolId },
            },
            {
              action: SCHOOL_ACTIONS.READ_FINANCE_DOCUMENT_TEMPLATES,
              resource: { kind: "school", schoolId },
            },
            {
              action: SCHOOL_ACTIONS.READ_SESSION_FINANCE,
              resource: { kind: "school", schoolId },
            },
          ]}
        >
          <Button
            type="button"
            variant="outline"
            onClick={() => onDialogChange("statement")}
          >
            <ReceiptText aria-hidden />
            Statement
          </Button>
        </RequirePermissions>
      </div>
      {dialog === "manual" ? (
        <ManualBillDialog {...baseProps} />
      ) : dialog === "payment" ? (
        <PaymentDialog {...baseProps} />
      ) : dialog === "adjustment" ? (
        <AdjustmentDialog {...baseProps} />
      ) : dialog === "refund" ? (
        <RefundDialog {...baseProps} />
      ) : dialog === "reversal" && selectedEntry ? (
        <ReversalDialog {...baseProps} />
      ) : dialog === "statement" ? (
        <StatementDocumentDialog key={statementDialogRevision} schoolId={schoolId} admissionIds={[admissionId]} sessions={statementSessions} defaultSessionId={statementSessionDefault} onClose={() => onDialogChange(null)} />
      ) : null}
    </>
  );
}

function AdmissionFinanceActionsLoader({
  schoolId,
  admissionId,
  registered,
  sessions,
  defaultSessionId,
  selectedEntry,
  dialog,
  onDialogChange,
}: {
  schoolId: string;
  admissionId: string;
  registered: boolean;
  sessions: LedgerSession[];
  defaultSessionId: string;
  selectedEntry?: LedgerEntry;
  dialog: ActionDialog;
  onDialogChange: (dialog: ActionDialog) => void;
}) {
  const financeQueries = useQueries({
    queries: sessions.map((session) =>
      orpc.school.getSessionFinance.queryOptions({
        input: { schoolId, sessionId: session.id },
      }),
    ),
  });
  const financeSessions: FinanceSessionOption[] = sessions.flatMap(
    (session, index) => {
      const config = financeQueries[index]?.data?.financeConfig;
      return config?.currency && config.timeZone
        ? [
            {
              ...session,
              currency: config.currency,
              timeZone: config.timeZone,
              feeElements: Object.entries(config.elements).map(
                ([slug, element]) => ({ slug, name: element.name }),
              ),
            },
          ]
        : [];
    },
  );
  const statementSessions: StatementSession[] = sessions.map(
    (session, index) => {
      const query = financeQueries[index];
      if (!query || query.isPending) {
        return { id: session.id, label: session.label, status: "checking" };
      }
      if (query.isError) {
        return {
          id: session.id,
          label: session.label,
          status: "error",
          error: query.error,
          retrying: query.isFetching,
          retry: () => query.refetch(),
        };
      }
      const config = query.data.financeConfig;
      if (
        !query.data.configurationReadiness.readyForBilling ||
        !config?.currency ||
        !config.timeZone ||
        !config.cycleStartMonth
      ) {
        return {
          id: session.id,
          label: session.label,
          status: "incomplete",
          missingFields: query.data.configurationReadiness.missingFields,
        };
      }
      return {
        id: session.id,
        label: session.label,
        status: "ready",
        currency: config.currency,
        timeZone: config.timeZone,
        cycleStartMonth: config.cycleStartMonth,
        startYear: session.startYear,
        endYear: session.endYear,
      };
    },
  );
  return (
    <AdmissionFinanceActions
      schoolId={schoolId}
      admissionId={admissionId}
      registered={registered}
      financeSessions={financeSessions}
      statementSessions={statementSessions}
      defaultSessionId={defaultSessionId}
      selectedEntry={selectedEntry}
      dialog={dialog}
      onDialogChange={onDialogChange}
    />
  );
}

function LedgerData({
  schoolId,
  admissionId,
  sessionId,
  sessionLabels,
  registered,
  sessions,
  defaultSessionId,
}: {
  schoolId: string;
  admissionId: string;
  sessionId?: string;
  sessionLabels: Map<string, string>;
  registered: boolean;
  sessions: LedgerSession[];
  defaultSessionId: string;
}) {
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<ActionDialog>(null);
  const [reversalEntry, setReversalEntry] = useState<LedgerEntry>();
  const [detailEntry, setDetailEntry] = useState<LedgerEntry>();
  const selectedEntry = reversalEntry;
  const summaryQuery = useQuery(
    orpc.school.getAdmissionFinanceSummary.queryOptions({
      input: { schoolId, admissionId, ...(sessionId ? { sessionId } : {}) },
    }),
  );
  const ledgerQuery = useQuery(
    orpc.school.getAdmissionLedger.queryOptions({
      input: {
        schoolId,
        admissionId,
        page,
        limit: 20,
        ...(sessionId ? { filters: { sessionId } } : {}),
      },
    }),
  );
  if (summaryQuery.isPending || ledgerQuery.isPending)
    return <FinanceLoading rows={5} />;
  const error = summaryQuery.error ?? ledgerQuery.error;
  if (error)
    return (
      <FinanceError title="Unable to load admission ledger" error={error} />
    );
  if (!summaryQuery.data || !ledgerQuery.data)
    return (
      <FinanceError
        title="Unable to load admission ledger"
        error={new Error("Ledger data was unavailable.")}
      />
    );
  const rows: FinanceLedgerRow[] = ledgerQuery.data.entries.items.map(
    (entry) => ({
      id: entry.id,
      effectiveAt: entry.effectiveAt,
      effectiveAtLabel: financeInstantLabel(entry.effectiveAt, entry.timeZone),
      sessionLabel: sessionLabels.get(entry.sessionId) ?? entry.sessionId,
      type: entry.type,
      debitMinor: entry.direction === "debit" ? entry.amountMinor : undefined,
      creditMinor: entry.direction === "credit" ? entry.amountMinor : undefined,
      currency: entry.currency,
      runningBalanceMinor: entry.runningBalanceMinor,
      reference: entryReference(entry),
      reversed: entry.reversed,
      recordedBy: entry.recordedBy,
      onOpen: () => {
        setReversalEntry(undefined);
        setDetailEntry(entry);
      },
    }),
  );
  const chartCurrencies = [
    ...new Set(summaryQuery.data.monthlyActivity.map((item) => item.currency)),
  ];
  const ledgerTable = (
    <div className="flex flex-col gap-2">
      {ledgerQuery.data.pageOpeningBalances.map((balance) => (
        <p key={balance.currency} className="text-xs text-muted-foreground">
          Page opening balance:{" "}
          {formatMinor(balance.balanceMinor, balance.currency)}
        </p>
      ))}
      <FinanceLedgerTable rows={rows} />
      <SimplePagination
        currentPage={ledgerQuery.data.entries.pagination.currentPage}
        totalPages={ledgerQuery.data.entries.pagination.totalPages}
        onPageChange={(next) => {
          setPage(next);
          setDetailEntry(undefined);
          setReversalEntry(undefined);
          setDialog(null);
        }}
      />
      {ledgerQuery.data.closingBalances.map((balance) => (
        <p
          key={balance.currency}
          className="text-right text-xs text-muted-foreground"
        >
          Closing balance: {formatMinor(balance.balanceMinor, balance.currency)}
        </p>
      ))}
    </div>
  );
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <RequirePermissions
        permissions={{
          action: SCHOOL_ACTIONS.READ_SESSION_FINANCE,
          resource: { kind: "school", schoolId },
        }}
      >
        <AdmissionFinanceActionsLoader
          schoolId={schoolId}
          admissionId={admissionId}
          registered={registered}
          sessions={sessions}
          defaultSessionId={sessionId ?? defaultSessionId}
          selectedEntry={selectedEntry}
          dialog={dialog}
          onDialogChange={(next) => {
            setDialog(next);
            if (!next) setReversalEntry(undefined);
          }}
        />
      </RequirePermissions>
      <Tabs defaultValue="graph">
        <TabsList aria-label="Ledger view">
          <TabsTrigger value="graph">Graph</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
        </TabsList>
        <TabsContent value="graph" className="flex flex-col gap-6">
          {chartCurrencies.length ? (
            <div className="flex flex-col gap-4">
              {chartCurrencies.map((currency) => (
                <FinanceMonthlyChart
                  key={currency}
                  currency={currency}
                  contextLabel={
                    sessionId
                      ? (sessionLabels.get(sessionId) ??
                        "Selected session activity")
                      : "Lifetime account"
                  }
                  activity={summaryQuery.data.monthlyActivity.filter(
                    (item) => item.currency === currency,
                  )}
                />
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              No financial activity has been recorded for this admission.
            </p>
          )}
          {ledgerTable}
        </TabsContent>
        <TabsContent value="details" className="flex flex-col gap-6">
          {summaryQuery.data.currencies.length ? (
            summaryQuery.data.currencies.map((summary) => (
              <section key={summary.currency} className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium">{summary.currency}</h3>
                  {sessionId ? (
                    <Badge variant="outline">
                      {sessionLabels.get(sessionId) ??
                        "Selected session activity"}
                    </Badge>
                  ) : (
                    <Badge variant="outline">Lifetime account</Badge>
                  )}
                </div>
                <FinanceSummaryCards
                  items={[
                    {
                      label: "Lifetime amount due",
                      value: formatMinor(summary.dueMinor, summary.currency),
                    },
                    {
                      label: "Lifetime account credit",
                      value: formatMinor(summary.creditMinor, summary.currency),
                    },
                    {
                      label: sessionId
                        ? "Selected-session billed"
                        : "Lifetime billed",
                      value: formatMinor(summary.billedMinor, summary.currency),
                    },
                    {
                      label: sessionId
                        ? "Selected-session collected"
                        : "Lifetime collected",
                      value: formatMinor(
                        summary.collectedMinor,
                        summary.currency,
                      ),
                    },
                    {
                      label: sessionId
                        ? "Selected-session credit adjustments"
                        : "Lifetime credit adjustments",
                      value: formatMinor(
                        summary.creditAdjustmentMinor,
                        summary.currency,
                      ),
                    },
                    {
                      label: sessionId
                        ? "Selected-session debit corrections"
                        : "Lifetime debit corrections",
                      value: formatMinor(
                        summary.debitAdjustmentMinor,
                        summary.currency,
                      ),
                    },
                    {
                      label: sessionId
                        ? "Selected-session refunds"
                        : "Lifetime refunds",
                      value: formatMinor(summary.refundMinor, summary.currency),
                    },
                    {
                      label: "Brought forward",
                      value: sessionId
                        ? formatMinor(
                            summary.broughtForwardMinor,
                            summary.currency,
                          )
                        : "—",
                      detail: sessionId
                        ? "Lifetime balance before this session"
                        : "Choose a session to calculate",
                    },
                    {
                      label: "Bills",
                      value: `${summary.billCounts.posted} posted`,
                      detail: `${summary.billCounts.reversed} reversed`,
                    },
                  ]}
                />
              </section>
            ))
          ) : (
            <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              No financial activity has been recorded for this admission.
            </p>
          )}
          {ledgerTable}
        </TabsContent>
      </Tabs>
      {detailEntry ? (
        <LedgerEntryDetail
          schoolId={schoolId}
          admissionId={admissionId}
          entry={detailEntry}
          onClose={() => {
            setDetailEntry(undefined);
            setReversalEntry(undefined);
          }}
          onReverse={() => {
            setReversalEntry(detailEntry);
            setDetailEntry(undefined);
            setDialog("reversal");
          }}
        />
      ) : null}
    </div>
  );
}

export function AdmissionLedger({
  schoolId,
  admissionId,
}: {
  schoolId: string;
  admissionId: string;
}) {
  const sessionsQuery = useSchoolSessions(schoolId);
  const admissionQuery = useQuery(
    orpc.school.getAdmission.queryOptions({ input: { schoolId, admissionId } }),
  );
  const form = useForm({
    defaultValues: { sessionId: "all" },
    validators: { onChange: z.object({ sessionId: z.string().min(1) }) },
  });
  if (sessionsQuery.isPending || admissionQuery.isPending)
    return <FinanceLoading />;
  const error = sessionsQuery.error ?? admissionQuery.error;
  if (error)
    return <FinanceError title="Unable to load ledger context" error={error} />;
  if (!sessionsQuery.data || !admissionQuery.data)
    return (
      <FinanceError
        title="Unable to load ledger context"
        error={new Error("Admission context was unavailable.")}
      />
    );
  const sessions = sessionsQuery.data.map((session) => ({
    id: session.id,
    label: `${session.sessionStartYear}–${session.sessionEndYear}`,
    startYear: session.sessionStartYear,
    endYear: session.sessionEndYear,
  }));
  const labels = new Map(
    sessions.map((session) => [session.id, session.label]),
  );
  const defaultSessionId =
    sessionsQuery.data.find((session) => session.isActive)?.id ??
    sessions[0]?.id ??
    "";
  return (
    <RequirePermissions
      permissions={{
        action: SCHOOL_ACTIONS.READ_ADMISSION_LEDGER,
        resource: { kind: "school", schoolId },
      }}
      fallback={
        <p className="text-sm text-muted-foreground">
          Ledger access is unavailable for your account.
        </p>
      }
    >
      <section className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Admission ledger</h2>
            <p className="text-xs text-muted-foreground">
              One continuous account across academic sessions, with exact
              running balances and immutable references.
            </p>
          </div>
          <form.Field name="sessionId">
            {(field) => (
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">
                  Session view
                </span>
                <Select
                  value={field.state.value}
                  onValueChange={field.handleChange}
                >
                  <SelectTrigger aria-label="Ledger session">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All sessions</SelectItem>
                    {sessions.map((session) => (
                      <SelectItem key={session.id} value={session.id}>
                        {session.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </form.Field>
        </div>
        <form.Subscribe selector={(state) => state.values.sessionId}>
          {(sessionId) => (
            <LedgerData
              key={sessionId}
              schoolId={schoolId}
              admissionId={admissionId}
              sessionId={sessionId === "all" ? undefined : sessionId}
              sessionLabels={labels}
              registered={admissionQuery.data.registered}
              sessions={sessions}
              defaultSessionId={defaultSessionId}
            />
          )}
        </form.Subscribe>
      </section>
    </RequirePermissions>
  );
}
