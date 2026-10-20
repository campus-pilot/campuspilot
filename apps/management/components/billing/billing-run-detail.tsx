"use client";

import { useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { SCHOOL_ACTIONS } from "@campuspilot/api/routers/authorization/authorization.dto";
import { billingRunDetailDtoSchema } from "@campuspilot/api/routers/school/billing/billing.dto";
import {
  civilDateTimeInTimeZone,
  financeDateTimeError,
  formatMinor,
  idempotencyForDraft,
  instantFromCivilDateTime,
  markIdempotencyAmbiguous,
  type IdempotencyDraftState,
} from "@campuspilot/components/finance";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@campuspilot/ui/components/alert-dialog";
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
import { Input } from "@campuspilot/ui/components/input";
import { Label } from "@campuspilot/ui/components/label";
import { Textarea } from "@campuspilot/ui/components/textarea";
import { RotateCcw } from "lucide-react";
import { client, orpc } from "@/lib/orpc";
import { RequirePermissions } from "@/components/require-permissions";
import { DirtyGuard } from "@/components/exam/exam-common";
import {
  FieldErrors,
  FinanceError,
  FinanceLoading,
  SimplePagination,
} from "./finance-ui";
import { invalidateFinanceReadModels } from "./finance-invalidation";
import { FinanceDocumentAction } from "./finance-document-action";

const reversalSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "Explain why this run is being reversed.")
    .max(1000),
  effectiveAt: z.string().min(1, "Choose an effective date and time."),
});
type BillingRun = z.infer<typeof billingRunDetailDtoSchema>;

function BillingRunHeader({
  run,
  schoolId,
  onReverse,
}: {
  run: BillingRun;
  schoolId: string;
  onReverse: () => void;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{run.periodKey}</h2>
          <Badge variant="outline" className="capitalize">
            {run.kind}
          </Badge>
          {run.fullyReversed ? (
            <Badge variant="secondary">Reversed</Badge>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {run.periodStartDate} – {run.periodEndDate} · {run.timeZone} · config{" "}
          {run.configHash.slice(0, 12)}…
        </p>
      </div>
      <RequirePermissions
        permissions={{
          action: SCHOOL_ACTIONS.REVERSE_BILLING_RUN,
          resource: { kind: "school", schoolId },
        }}
      >
        <Button
          type="button"
          variant="destructive"
          disabled={run.fullyReversed}
          onClick={onReverse}
        >
          <RotateCcw aria-hidden />
          Reverse run
        </Button>
      </RequirePermissions>
    </header>
  );
}

function BillingRunSummary({ run }: { run: BillingRun }) {
  const items = [
    {
      label: "Posted total",
      value: formatMinor(run.totalAmountMinor, run.currency),
    },
    { label: "Bills", value: String(run.billCount) },
    { label: "Reversed bills", value: String(run.reversedBillCount) },
  ];
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        {items.map((item) => (
          <div key={item.label} className="rounded-xl border p-3">
            <p className="text-xs text-muted-foreground">{item.label}</p>
            <p className="text-lg font-semibold">{item.value}</p>
          </div>
        ))}
      </div>
      {run.supplementalReason ? (
        <div className="rounded-xl border bg-muted/30 p-3">
          <p className="text-xs font-medium">Supplemental reason</p>
          <p className="text-sm">{run.supplementalReason}</p>
        </div>
      ) : null}
    </>
  );
}

function PostedBills({
  run,
  onPageChange,
}: {
  run: BillingRun;
  onPageChange: (page: number) => void;
}) {
  return (
    <section className="flex flex-col gap-3 overflow-x-auto">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="font-medium">Posted bills</h3>
        <p className="text-xs text-muted-foreground">Immutable bill and pricing snapshots from this run.</p></div>
        {run.billCount ? <FinanceDocumentAction schoolId={run.schoolId} source={{ documentType: "bill", sessionId: run.sessionId, billRunId: run.id }} label="PDFs for full run" /> : null}
      </header>
      <table className="w-full min-w-[850px] rounded-xl border text-xs">
        <thead className="bg-muted/40">
          <tr>
            <th className="p-2 text-left">Bill</th>
            <th className="p-2 text-left">Admission</th>
            <th className="p-2 text-left">Placement snapshot</th>
            <th className="p-2 text-left">Fee lines</th>
            <th className="p-2 text-right">Total</th>
            <th className="p-2 text-left">Document</th>
          </tr>
        </thead>
        <tbody>
          {run.bills.items.map((bill) => (
            <tr key={bill.id} className="border-t align-top">
              <td className="p-2 font-mono">
                {bill.billNumber}
                {bill.reversed ? " · Reversed" : ""}
              </td>
              <td className="p-2 font-medium">
                {bill.admissionNameSnapshot} · {bill.admissionNumberSnapshot}
              </td>
              <td className="p-2">
                {bill.classLabelSnapshot ?? "Unplaced"}
                {bill.sectionLabelSnapshot
                  ? ` · ${bill.sectionLabelSnapshot}`
                  : ""}
              </td>
              <td className="p-2">
                {bill.lines
                  .map(
                    (line) =>
                      `${line.feeElementName}: ${formatMinor(line.amountMinor, bill.currency)} (${line.pricingSourceKind.replaceAll("_", " ")})`,
                  )
                  .join("; ")}
              </td>
              <td className="p-2 text-right font-medium">
                {formatMinor(bill.totalAmountMinor, bill.currency)}
              </td>
              <td className="p-2">
                <FinanceDocumentAction schoolId={run.schoolId} source={{ documentType: "bill", sessionId: run.sessionId, billIds: [bill.id] }} label="Bill PDF" />
              </td>
            </tr>
          ))}
          {!run.bills.items.length ? (
            <tr>
              <td
                colSpan={6}
                className="h-32 p-3 text-center text-muted-foreground"
              >
                No bills on this page.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <SimplePagination
        currentPage={run.bills.pagination.currentPage}
        totalPages={run.bills.pagination.totalPages}
        onPageChange={onPageChange}
      />
    </section>
  );
}

function RunReversalForm({
  schoolId,
  sessionId,
  billRunId,
  periodKey,
  amount,
  timeZone,
  onClose,
}: {
  schoolId: string;
  sessionId: string;
  billRunId: string;
  periodKey: string;
  amount: string;
  timeZone: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const idempotency = useRef<IdempotencyDraftState>(undefined);
  const mutation = useMutation({
    mutationFn: (input: any) => client.school.reverseBillingRun(input),
  });
  const schema = reversalSchema.superRefine((value, context) => {
    const message = financeDateTimeError(value.effectiveAt, timeZone);
    if (message)
      context.addIssue({ code: "custom", path: ["effectiveAt"], message });
  });
  const form = useForm({
    defaultValues: {
      reason: "",
      effectiveAt: civilDateTimeInTimeZone(timeZone),
    },
    validators: { onSubmit: schema },
    onSubmit: async () => setConfirmOpen(true),
  });
  async function reverseRun(value: z.infer<typeof schema>) {
    form.setErrorMap({});
    const parsed = schema.safeParse(value);
    if (!parsed.success) return;
    const effectiveAt = instantFromCivilDateTime(
      parsed.data.effectiveAt,
      timeZone,
    );
    const fingerprint = JSON.stringify({
      schoolId,
      sessionId,
      billRunId,
      reason: parsed.data.reason.trim(),
      effectiveAt: effectiveAt.toISOString(),
    });
    idempotency.current = idempotencyForDraft(
      idempotency.current,
      fingerprint,
      () => crypto.randomUUID(),
    );
    try {
      await mutation.mutateAsync({
        schoolId,
        sessionId,
        billRunId,
        reason: parsed.data.reason.trim(),
        effectiveAt,
        idempotencyKey: idempotency.current.key,
      });
      await invalidateFinanceReadModels(queryClient, "billing_run");
      setConfirmOpen(false);
      onClose();
    } catch (error) {
      idempotency.current = markIdempotencyAmbiguous(idempotency.current);
      await invalidateFinanceReadModels(queryClient, "billing_run");
      setConfirmOpen(false);
      form.setErrorMap({
        onSubmit: {
          fields: {},
          form:
            error instanceof Error
              ? `${error.message} The command key was retained while the run reloads.`
              : "The result is uncertain. The command key was retained while the run reloads.",
        },
      });
    }
  }
  function requestClose(dirty: boolean) {
    if (dirty) setDiscardOpen(true);
    else onClose();
  }
  return (
    <form.Subscribe
      selector={(state) => ({ dirty: state.isDirty, values: state.values })}
    >
      {({ dirty, values }) => (
        <>
          <DirtyGuard
            dirty={dirty}
            description="The run reversal effective time and reason will be lost."
          />
          <Dialog
            open
            onOpenChange={(open) => {
              if (!open) requestClose(dirty);
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Reverse billing run</DialogTitle>
                <DialogDescription>
                  Prepare a reversal for {periodKey}. Every unsettled bill
                  receives an immutable opposite ledger entry; the operation
                  fails atomically if any bill is settled or reversed.
                </DialogDescription>
              </DialogHeader>
              <form
                className="flex flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void form.handleSubmit();
                }}
              >
                <form.Field name="effectiveAt">
                  {(field) => (
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="run-reversal-effective">
                        Effective at ({timeZone})
                      </Label>
                      <Input
                        id="run-reversal-effective"
                        type="datetime-local"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                      />
                      <FieldErrors errors={field.state.meta.errors} />
                    </div>
                  )}
                </form.Field>
                <form.Field name="reason">
                  {(field) => (
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="run-reversal-reason">Reason</Label>
                      <Textarea
                        id="run-reversal-reason"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                      />
                      <FieldErrors errors={field.state.meta.errors} />
                    </div>
                  )}
                </form.Field>
                <form.Subscribe
                  selector={(state) => ({
                    canSubmit: state.canSubmit,
                    errors: state.errors,
                    isSubmitting: state.isSubmitting,
                  })}
                >
                  {({ canSubmit, errors, isSubmitting }) => (
                    <>
                      <FieldErrors errors={errors} />
                      <DialogFooter>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={isSubmitting || mutation.isPending}
                          onClick={() => requestClose(dirty)}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="submit"
                          variant="destructive"
                          disabled={
                            !canSubmit || isSubmitting || mutation.isPending
                          }
                        >
                          Review reversal
                        </Button>
                      </DialogFooter>
                    </>
                  )}
                </form.Subscribe>
              </form>
            </DialogContent>
          </Dialog>
          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reverse run {periodKey}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will reverse {amount} across every eligible bill in the
                  run. This correction is immutable.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={mutation.isPending}>
                  Keep editing
                </AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={mutation.isPending}
                  onClick={(event) => {
                    event.preventDefault();
                    void reverseRun(values);
                  }}
                >
                  {mutation.isPending ? "Reversing…" : "Confirm reversal"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Discard reversal draft?</AlertDialogTitle>
                <AlertDialogDescription>
                  The effective time and reason will be lost.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep editing</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={onClose}>
                  Discard draft
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </form.Subscribe>
  );
}

function RunReversalDialog({
  schoolId,
  sessionId,
  billRunId,
  onClose,
}: {
  schoolId: string;
  sessionId: string;
  billRunId: string;
  onClose: () => void;
}) {
  const query = useQuery(
    orpc.school.getBillingRun.queryOptions({
      input: { schoolId, sessionId, billRunId, page: 1, limit: 1 },
    }),
  );
  if (query.isPending)
    return (
      <Dialog open>
        <DialogContent>
          <FinanceLoading rows={2} />
        </DialogContent>
      </Dialog>
    );
  if (query.isError)
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent>
          <FinanceError
            title="Unable to load reversal target"
            error={query.error}
          />
        </DialogContent>
      </Dialog>
    );
  return (
    <RunReversalForm
      schoolId={schoolId}
      sessionId={sessionId}
      billRunId={billRunId}
      periodKey={query.data.periodKey}
      amount={formatMinor(query.data.totalAmountMinor, query.data.currency)}
      timeZone={query.data.timeZone}
      onClose={onClose}
    />
  );
}

export function BillingRunDetail({
  schoolId,
  sessionId,
  billRunId,
  initialPage = 1,
}: {
  schoolId: string;
  sessionId: string;
  billRunId: string;
  initialPage?: number;
}) {
  const [page, setPage] = useState(initialPage);
  const [reversalOpen, setReversalOpen] = useState(false);
  const query = useQuery(
    orpc.school.getBillingRun.queryOptions({
      input: { schoolId, sessionId, billRunId, page, limit: 20 },
    }),
  );
  if (query.isPending) return <FinanceLoading rows={4} />;
  if (query.isError)
    return (
      <FinanceError title="Unable to load billing run" error={query.error} />
    );
  const run = query.data;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <BillingRunHeader
        run={run}
        schoolId={schoolId}
        onReverse={() => setReversalOpen(true)}
      />
      <BillingRunSummary run={run} />
      <PostedBills run={run} onPageChange={setPage} />
      {reversalOpen ? (
        <RunReversalDialog
          schoolId={schoolId}
          sessionId={sessionId}
          billRunId={billRunId}
          onClose={() => setReversalOpen(false)}
        />
      ) : null}
    </div>
  );
}
