"use client";

import { useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import type { z } from "zod";
import { z as zod } from "zod";
import { SCHOOL_ACTIONS } from "@campuspilot/api/routers/authorization/authorization.dto";
import { paymentListOutputSchema } from "@campuspilot/api/routers/school/billing/ledger.dto";
import {
  DataTable,
  DataTableSuspense,
  TableFilterBar,
  TableSearchBar,
  useDataTableListState,
  type DataTableColumnDef,
  type TableFilterConfig,
} from "@campuspilot/components/data-grid";
import {
  formatFinanceInstant,
  formatMinor,
  paymentDeepLinkTarget,
} from "@campuspilot/components/finance";
import { Badge } from "@campuspilot/ui/components/badge";
import { Button } from "@campuspilot/ui/components/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@campuspilot/ui/components/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@campuspilot/ui/components/dialog";
import { ExternalLink } from "lucide-react";
import { orpc } from "@/lib/orpc";
import { RequirePermissions } from "@/components/require-permissions";
import {
  PaymentDialog,
  type FinanceSessionOption,
} from "./admission-finance-dialogs";
import {
  FieldErrors,
  FinanceError,
  FinanceLoading,
  SimplePagination,
} from "./finance-ui";
import { FinanceDocumentAction } from "./finance-document-action";

type Payment = z.infer<typeof paymentListOutputSchema>["items"][number];
type Filters = { method?: Payment["method"]; status?: Payment["status"] };
type PaymentTarget = Pick<Payment, "id"> & {
  admissionId?: string;
  receiptNumber?: string;
};

const admissionOptionSchema = zod.object({
  id: zod.string().min(1),
  name: zod.string(),
  admissionNo: zod.string(),
});
type AdmissionOption = zod.infer<typeof admissionOptionSchema>;
const paymentEntrySchema = zod.object({
  admission: admissionOptionSchema
    .nullable()
    .refine((value) => value !== null, "Select an admission."),
  search: zod.string(),
});

function PaymentAdmissionSearch({
  schoolId,
  value,
  search,
  onValueChange,
  onSearchChange,
}: {
  schoolId: string;
  value: AdmissionOption | null;
  search: string;
  onValueChange: (value: AdmissionOption | null) => void;
  onSearchChange: (value: string) => void;
}) {
  const popupContainer = useRef<HTMLDivElement>(null);
  const query = useQuery(
    orpc.school.listAdmissions.queryOptions({
      input: {
        schoolId,
        page: 1,
        limit: 20,
        searchQuery: search.trim() || undefined,
      },
    }),
  );
  const admissions = query.data?.items ?? [];
  const items =
    value && !admissions.some(({ id }) => id === value.id)
      ? [value, ...admissions]
      : admissions;
  return (
    <div ref={popupContainer} className="min-w-64 flex-1">
      <Combobox
        items={items}
        filteredItems={admissions}
        filter={null}
        value={value}
        inputValue={search}
        onValueChange={onValueChange}
        onInputValueChange={onSearchChange}
        itemToStringLabel={(admission) => admission.name}
        isItemEqualToValue={(admission, selected) =>
          admission.id === selected.id
        }
      >
        <ComboboxInput
          aria-label="Admission for payment"
          className="w-full"
          placeholder="Search admission name or number…"
          showClear
        />
        <ComboboxContent container={popupContainer}>
          <ComboboxEmpty>
            {query.isPending
              ? "Loading admissions…"
              : query.isError
                ? "Unable to load admissions."
                : "No admissions found."}
          </ComboboxEmpty>
          <ComboboxList>
            {(admission: AdmissionOption) => (
              <ComboboxItem key={admission.id} value={admission}>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{admission.name}</span>
                  <span className="truncate text-muted-foreground">
                    Admission {admission.admissionNo}
                  </span>
                </span>
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}

function RecordPaymentEntry({
  schoolId,
  sessionId,
}: {
  schoolId: string;
  sessionId: string;
}) {
  const [target, setTarget] = useState<AdmissionOption>();
  const financeQuery = useQuery(
    orpc.school.getSessionFinance.queryOptions({
      input: { schoolId, sessionId },
    }),
  );
  const form = useForm({
    defaultValues: { admission: null as AdmissionOption | null, search: "" },
    validators: { onSubmit: paymentEntrySchema },
    onSubmit: async ({ value }) => {
      const parsed = paymentEntrySchema.parse(value);
      setTarget(parsed.admission!);
    },
  });
  const config = financeQuery.data?.financeConfig;
  const session: FinanceSessionOption | undefined =
    config?.currency && config.timeZone
      ? {
          id: sessionId,
          label: "Current session",
          currency: config.currency,
          timeZone: config.timeZone,
          feeElements: Object.entries(config.elements).map(
            ([slug, element]) => ({ slug, name: element.name }),
          ),
        }
      : undefined;
  return (
    <div className="flex flex-col gap-2 rounded-xl border p-3">
      <p className="text-sm font-medium">Record a payment</p>
      <form
        className="flex flex-wrap items-start gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <form.Subscribe
          selector={(state) => ({
            admission: state.values.admission,
            search: state.values.search,
          })}
        >
          {({ admission, search }) => (
            <form.Field name="admission">
              {(admissionField) => (
                <form.Field name="search">
                  {(searchField) => (
                    <PaymentAdmissionSearch
                      schoolId={schoolId}
                      value={admission}
                      search={search}
                      onValueChange={admissionField.handleChange}
                      onSearchChange={searchField.handleChange}
                    />
                  )}
                </form.Field>
              )}
            </form.Field>
          )}
        </form.Subscribe>
        <form.Subscribe
          selector={(state) => ({
            canSubmit: state.canSubmit,
            isSubmitting: state.isSubmitting,
            errors: state.errors,
          })}
        >
          {({ canSubmit, isSubmitting, errors }) => (
            <div className="flex flex-col gap-1">
              <Button
                type="submit"
                disabled={
                  !canSubmit ||
                  isSubmitting ||
                  financeQuery.isPending ||
                  !session
                }
              >
                Record payment
              </Button>
              <FieldErrors errors={errors} />
            </div>
          )}
        </form.Subscribe>
      </form>
      {financeQuery.isError ? (
        <p className="text-xs text-destructive">
          Unable to load this session's finance configuration.
        </p>
      ) : null}
      {target && session ? (
        <PaymentDialog
          schoolId={schoolId}
          admissionId={target.id}
          sessions={[session]}
          defaultSessionId={session.id}
          onClose={() => {
            setTarget(undefined);
            form.reset();
          }}
        />
      ) : null}
    </div>
  );
}

function financeInstantLabel(value: Date, timeZone: string | null) {
  return timeZone
    ? formatFinanceInstant(value, timeZone)
    : "Timezone unavailable";
}

function PaymentDetail({
  schoolId,
  payment,
  onClose,
}: {
  schoolId: string;
  payment: PaymentTarget;
  onClose: () => void;
}) {
  const [refundPage, setRefundPage] = useState(1);
  const query = useQuery(
    orpc.school.getPayment.queryOptions({
      input: {
        schoolId,
        admissionId: payment.admissionId,
        paymentId: payment.id,
        refundPage,
        refundLimit: 10,
      },
    }),
  );
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {query.data?.receiptNumber ??
              payment.receiptNumber ??
              "Payment detail"}
          </DialogTitle>
          <DialogDescription>
            Immutable account-credit payment and refund details.
          </DialogDescription>
        </DialogHeader>
        {query.isPending ? (
          <FinanceLoading />
        ) : query.isError ? (
          <FinanceError title="Unable to load payment" error={query.error} />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Amount</p>
                <p className="font-semibold">
                  {formatMinor(query.data.amountMinor, query.data.currency)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Refunded</p>
                <p className="font-semibold">
                  {formatMinor(query.data.refundedMinor, query.data.currency)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  Refundable
                </p>
                <p className="font-semibold">
                  {formatMinor(
                    query.data.refundableMinor,
                    query.data.currency,
                  )}
                </p>
              </div>
            </div>
            <p className="rounded-lg border p-3 text-sm text-muted-foreground">This payment is credited to the admission account and is not assigned to any individual bill.</p>
            {query.data.refunds.pagination.totalItems ? (
              <div>
                <h3 className="mb-2 text-sm font-medium">Refunds</h3>
                {query.data.refunds.items.map((refund) => (
                  <div
                    key={refund.id}
                    className="flex items-center justify-between gap-3 border-t py-2"
                  >
                    <span className="flex items-center gap-2 font-mono">
                      {refund.refundNumber}
                      {refund.reversed ? (
                        <Badge variant="secondary">Reversed</Badge>
                      ) : null}
                    </span>
                    <span>
                      {formatMinor(refund.amountMinor, refund.currency)}
                    </span>
                    <FinanceDocumentAction schoolId={schoolId} source={{ documentType: "receipt", sessionId: query.data.sessionId, transactions: [{ kind: "refund", id: refund.id }] }} label="Refund receipt" />
                  </div>
                ))}
                <SimplePagination
                  currentPage={query.data.refunds.pagination.currentPage}
                  totalPages={query.data.refunds.pagination.totalPages}
                  onPageChange={setRefundPage}
                />
              </div>
            ) : null}
            <FinanceDocumentAction schoolId={schoolId} source={{ documentType: "receipt", sessionId: query.data.sessionId, transactions: [{ kind: "payment", id: query.data.id }] }} label="Generate receipt PDF" />
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaymentRows({
  schoolId,
  sessionId,
  controller,
  onOpen,
  onClear,
}: {
  schoolId: string;
  sessionId: string;
  controller: ReturnType<typeof useDataTableListState<"receivedAt", Filters>>;
  onOpen: (payment: Payment) => void;
  onClear: () => void;
}) {
  const { data } = useSuspenseQuery(
    orpc.school.listPayments.queryOptions({
      input: {
        schoolId,
        page: controller.query.page,
        limit: controller.query.limit,
        filters: {
          sessionId,
          ...(controller.query.searchQuery
            ? { search: controller.query.searchQuery }
            : {}),
          ...(controller.query.filters?.method
            ? { method: controller.query.filters.method }
            : {}),
          ...(controller.query.filters?.status
            ? { status: controller.query.filters.status }
            : {}),
        },
      },
    }),
  );
  const columns: DataTableColumnDef<Payment>[] = [
    {
      accessorKey: "receiptNumber",
      header: "Receipt",
      enableSorting: false,
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.receiptNumber}</span>
      ),
    },
    {
      accessorKey: "admissionName",
      header: "Admission",
      enableSorting: false,
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.admissionName}</p>
          <p className="text-xs text-muted-foreground">
            {row.original.admissionNumber}
          </p>
        </div>
      ),
    },
    {
      accessorKey: "receivedAt",
      header: "Received",
      enableSorting: false,
      cell: ({ row }) =>
        financeInstantLabel(row.original.receivedAt, row.original.timeZone),
    },
    {
      accessorKey: "method",
      header: "Method",
      enableSorting: false,
      cell: ({ row }) => (
        <span className="capitalize">
          {row.original.method.replaceAll("_", " ")}
        </span>
      ),
    },
    {
      accessorKey: "amountMinor",
      header: "Amount",
      enableSorting: false,
      cell: ({ row }) => (
        <span className="font-medium">
          {formatMinor(row.original.amountMinor, row.original.currency)}
        </span>
      ),
    },
    {
      accessorKey: "refundableMinor",
      header: "Refundable",
      enableSorting: false,
      cell: ({ row }) =>
        formatMinor(row.original.refundableMinor, row.original.currency),
    },
    {
      accessorKey: "status",
      header: "Status",
      enableSorting: false,
      cell: ({ row }) => (
        <Badge variant="outline" className="capitalize">
          {row.original.status.replaceAll("_", " ")}
        </Badge>
      ),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onOpen(row.original)}
        >
          View
          <span className="sr-only"> payment {row.original.receiptNumber}</span>
          <ExternalLink aria-hidden />
        </Button>
      ),
    },
  ];
  return (
    <DataTable
      ariaLabel="Payment register"
      columns={columns}
      data={data.items}
      getRowId={(item) => item.id}
      manualPagination
      pageCount={data.pagination.totalPages}
      rowCount={data.pagination.totalItems}
      showPagination
      state={{ pagination: controller.tableState.pagination }}
      onPaginationChange={(updater) => {
        onClear();
        controller.onPaginationChange(updater);
      }}
      emptyMessage="No payments match this view."
    />
  );
}

export function BillingPayments({
  schoolId,
  sessionId,
  initialPaymentId,
  initialAdmissionId,
}: {
  schoolId: string;
  sessionId: string;
  initialPaymentId?: string;
  initialAdmissionId?: string;
}) {
  const [selected, setSelected] = useState<PaymentTarget | undefined>(
    paymentDeepLinkTarget(initialPaymentId, initialAdmissionId),
  );
  const controller = useDataTableListState<"receivedAt", Filters>({
    defaultOrderBy: { field: "receivedAt", direction: "desc" },
  });
  const filters: TableFilterConfig<keyof Filters>[] = [
    {
      id: "method",
      label: "Method",
      type: "single",
      options: ["cash", "bank_transfer", "card", "cheque", "other"].map(
        (value) => ({ value, label: value.replaceAll("_", " ") }),
      ),
    },
    {
      id: "status",
      label: "Status",
      type: "single",
      options: [
        "recorded",
        "partially_refunded",
        "refunded",
        "reversed",
      ].map((value) => ({ value, label: value.replaceAll("_", " ") })),
    },
  ];
  const resource = { kind: "school" as const, schoolId };
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Payment register</h2>
        <p className="text-xs text-muted-foreground">
          Search receipt, admission, payer, and external references recorded in
          this session.
        </p>
      </div>
      <RequirePermissions
        permissions={[
          SCHOOL_ACTIONS.READ_SESSION_FINANCE,
          SCHOOL_ACTIONS.RECORD_PAYMENT,
        ].map((action) => ({ action, resource }))}
      >
        <RecordPaymentEntry schoolId={schoolId} sessionId={sessionId} />
      </RequirePermissions>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <TableSearchBar
          placeholder="Search receipts or admissions…"
          onSearchChange={(value) => {
            setSelected(undefined);
            controller.onSearchChange(value);
          }}
        />
        <TableFilterBar
          filters={filters}
          values={controller.query.filters ?? {}}
          onValuesChange={(values) => {
            setSelected(undefined);
            controller.onFiltersChange(values);
          }}
        />
      </div>
      <DataTableSuspense key={JSON.stringify(controller.query)} columnCount={8}>
        <PaymentRows
          schoolId={schoolId}
          sessionId={sessionId}
          controller={controller}
          onOpen={setSelected}
          onClear={() => setSelected(undefined)}
        />
      </DataTableSuspense>
      {selected ? (
        <PaymentDetail
          schoolId={schoolId}
          payment={selected}
          onClose={() => setSelected(undefined)}
        />
      ) : null}
    </section>
  );
}
