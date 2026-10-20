"use client";

import { useRef } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { civilDateTimeInTimeZone, decimalToMinor, formatMinor, instantFromCivilDateTime, requiresExplicitCreditConfirmation, updateExplicitAllocation, type ExplicitAllocationDraft, type IdempotencyDraftState } from "@campuspilot/components/finance";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@campuspilot/ui/components/alert-dialog";
import { Badge } from "@campuspilot/ui/components/badge";
import { Button } from "@campuspilot/ui/components/button";
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@campuspilot/ui/components/dialog";
import { Input } from "@campuspilot/ui/components/input";
import { Label } from "@campuspilot/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@campuspilot/ui/components/select";
import { Textarea } from "@campuspilot/ui/components/textarea";
import { client, orpc } from "@/lib/orpc";
import { invalidateFinanceReadModels } from "./finance-invalidation";
import { FieldErrors, FinanceError, FinanceLoading, SimplePagination } from "./finance-ui";
import { auditAmbiguous, dateTimeSchema, FormGuardedDialog, idSchema, MethodField, paymentMethods, positiveDecimalSchema, SessionField, sessionFor, stableKey, SubmitFooter, validateDateTime, validateMoney, type FinanceDialogBaseProps, type FinanceSessionOption, type PaymentMethod } from "./finance-dialog-common";

type AllocationSelection = ExplicitAllocationDraft & { billNumber: string; sessionLabel: string; outstandingMinor: string };
const baseSchema = z.object({ sessionId: idSchema, amount: positiveDecimalSchema, allocationMode: z.enum(["proposal", "explicit", "unallocated"]), allocations: z.array(z.object({ billId: idSchema, billNumber: z.string(), sessionLabel: z.string(), outstandingMinor: z.string(), amount: positiveDecimalSchema })).max(500), billSearch: z.string(), billPage: z.number().int().positive(), method: z.enum(paymentMethods), receivedAt: dateTimeSchema, payerName: z.string(), reference: z.string(), note: z.string(), creditConfirming: z.boolean(), finalConfirming: z.boolean(), creditConfirmed: z.boolean() });

function AllocationAmountField({ form, billId, index }: { form: any; billId: string; index: number }) {
  return <form.Field name={`allocations[${index}].amount`}>{(field: any) => <div className="flex flex-col gap-1"><Label htmlFor={`allocation-${billId}`}>Amount</Label><Input id={`allocation-${billId}`} className="w-36" inputMode="decimal" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} /><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field>;
}

function ExplicitAllocations({ form, schoolId, admissionId, session, values, search, page }: { form: any; schoolId: string; admissionId: string; session: FinanceSessionOption; values: AllocationSelection[]; search: string; page: number }) {
  const query = useQuery(orpc.school.listAdmissionBills.queryOptions({ input: { schoolId, page, limit: 20, filters: { admissionId, currency: session.currency, status: "open", ...(search.trim() ? { search: search.trim() } : {}) } } }));
  if (query.isPending) return <FinanceLoading rows={2} />;
  if (query.isError) return <FinanceError title="Unable to load outstanding bills" error={query.error} />;
  const selected = new Map(values.map((value) => [value.billId, value]));
  return <fieldset className="flex flex-col gap-3 rounded-xl border p-3"><legend className="px-1 text-sm font-medium">Explicit bill allocations</legend><form.Field name="billSearch">{(field: any) => <div className="flex flex-col gap-1.5"><Label htmlFor="payment-bill-search">Search bills</Label><Input id="payment-bill-search" value={field.state.value} placeholder="Bill number or admission…" onChange={(event) => { field.handleChange(event.target.value); form.setFieldValue("billPage", 1); }} /><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field><div className="flex flex-col gap-2">{query.data.items.map((bill) => {
    const allocation = selected.get(bill.id);
    const sessionLabel = `${bill.sessionStartYearSnapshot}–${bill.sessionEndYearSnapshot}`;
    return <div key={bill.id} className="flex flex-wrap items-end gap-2 rounded-lg border p-2"><Button type="button" size="sm" variant={allocation ? "secondary" : "outline"} aria-pressed={Boolean(allocation)} onClick={() => form.setFieldValue("allocations", allocation ? updateExplicitAllocation(values, bill.id, undefined) : [...values, { billId: bill.id, billNumber: bill.billNumber, sessionLabel, outstandingMinor: bill.outstandingMinor, amount: "" }])}>{allocation ? "Remove" : "Add"}</Button><div className="min-w-40 flex-1"><p className="font-mono text-sm">{bill.billNumber}</p><p className="text-xs text-muted-foreground">{sessionLabel} · {formatMinor(bill.outstandingMinor, bill.currency)} outstanding</p></div>{allocation ? <AllocationAmountField form={form} billId={bill.id} index={values.findIndex((value) => value.billId === bill.id)} /> : null}</div>;
  })}</div><form.Field name="allocations">{(field: any) => <FieldErrors errors={field.state.meta.errors} />}</form.Field><p className="text-xs text-muted-foreground">{values.length} of 500 bills selected across sessions.</p><SimplePagination currentPage={query.data.pagination.currentPage} totalPages={query.data.pagination.totalPages} onPageChange={(next) => form.setFieldValue("billPage", next)} /></fieldset>;
}

function PaymentFields({ form }: { form: any }) {
  return <><div className="grid gap-3 sm:grid-cols-2"><form.Field name="amount">{(field: any) => <div className="flex flex-col gap-1.5"><Label htmlFor="payment-amount">Amount</Label><Input id="payment-amount" inputMode="decimal" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} /><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field><MethodField form={form} id="payment-method" /></div><form.Field name="receivedAt">{(field: any) => <div className="flex flex-col gap-1.5"><Label htmlFor="payment-received">Received at</Label><Input id="payment-received" type="datetime-local" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} /><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field><div className="grid gap-3 sm:grid-cols-2"><form.Field name="payerName">{(field: any) => <div className="flex flex-col gap-1.5"><Label htmlFor="payment-payer">Payer name (optional)</Label><Input id="payment-payer" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} /><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field><form.Field name="reference">{(field: any) => <div className="flex flex-col gap-1.5"><Label htmlFor="payment-reference">External reference (optional)</Label><Input id="payment-reference" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} /><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field></div><form.Field name="note">{(field: any) => <div className="flex flex-col gap-1.5"><Label htmlFor="payment-note">Note (optional)</Label><Textarea id="payment-note" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} /><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field></>;
}

export function PaymentDialog(props: FinanceDialogBaseProps) {
  const queryClient = useQueryClient();
  const keyRef = useRef<IdempotencyDraftState>(undefined);
  const reviewedDraft = useRef<string>(undefined);
  const initial = sessionFor(props.sessions, props.defaultSessionId);
  const previewMutation = useMutation({ mutationFn: (input: any) => client.school.previewPaymentAllocation(input) });
  const recordMutation = useMutation({ mutationFn: (input: any) => client.school.recordPayment(input) });
  const schema = baseSchema.superRefine((value, context) => {
    validateMoney(props.sessions, value.sessionId, value.amount, context, ["amount"]);
    validateDateTime(props.sessions, value.sessionId, value.receivedAt, context, "receivedAt");
    if (value.allocationMode === "explicit" && !value.allocations.length) context.addIssue({ code: "custom", path: ["allocations"], message: "Select at least one outstanding bill." });
    if (value.allocationMode === "explicit") value.allocations.forEach((allocation, index) => validateMoney(props.sessions, value.sessionId, allocation.amount, context, ["allocations", index, "amount"]));
  });
  type Value = z.infer<typeof schema>;
  const form = useForm({ defaultValues: { sessionId: initial.id, amount: "", allocationMode: "proposal" as Value["allocationMode"], allocations: [] as AllocationSelection[], billSearch: "", billPage: 1, method: "cash" as PaymentMethod, receivedAt: civilDateTimeInTimeZone(initial.timeZone), payerName: "", reference: "", note: "", creditConfirming: false, finalConfirming: false, creditConfirmed: false }, validators: { onSubmit: schema }, onSubmit: async ({ value }) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) return;
    const session = sessionFor(props.sessions, parsed.data.sessionId);
    const allocations = parsed.data.allocationMode === "explicit" ? parsed.data.allocations.map((allocation) => ({ billId: allocation.billId, amountMinor: decimalToMinor(allocation.amount, session.currency) })) : undefined;
    form.setErrorMap({});
    try {
      await previewMutation.mutateAsync({ schoolId: props.schoolId, admissionId: props.admissionId, sessionId: session.id, currency: session.currency, amountMinor: decimalToMinor(parsed.data.amount, session.currency), allocationMode: parsed.data.allocationMode, ...(allocations ? { allocations } : {}) });
      reviewedDraft.current = fingerprint(parsed.data);
      form.setFieldValue("creditConfirmed", false);
    } catch (error) {
      reviewedDraft.current = undefined;
      form.setErrorMap({ onSubmit: { fields: {}, form: error instanceof Error ? error.message : "Unable to preview this payment allocation." } });
    }
  } });
  const preview = previewMutation.data;
  function fingerprint(value: Value) { return JSON.stringify({ ...value, creditConfirming: false, finalConfirming: false, creditConfirmed: false }); }
  function requestRecord(value: Value) {
    if (!preview || reviewedDraft.current !== fingerprint(value)) { form.setErrorMap({ onSubmit: { fields: {}, form: "Payment details changed after preview. Refresh the allocation." } }); return; }
    if (requiresExplicitCreditConfirmation(preview.unallocatedCreditMinor) && !value.creditConfirmed) form.setFieldValue("creditConfirming", true);
    else form.setFieldValue("finalConfirming", true);
  }
  async function record(value: Value) {
    if (!preview || reviewedDraft.current !== fingerprint(value)) return;
    const session = sessionFor(props.sessions, value.sessionId);
    const allocations = value.allocationMode === "explicit" ? value.allocations.map((allocation) => ({ billId: allocation.billId, amountMinor: decimalToMinor(allocation.amount, session.currency) })) : undefined;
    const receivedAt = instantFromCivilDateTime(value.receivedAt, session.timeZone);
    const command = { schoolId: props.schoolId, admissionId: props.admissionId, sessionId: session.id, currency: session.currency, amountMinor: decimalToMinor(value.amount, session.currency), allocationMode: value.allocationMode, ...(allocations ? { allocations } : {}), ...(value.allocationMode === "proposal" ? { expectedAllocationReviewHash: preview.allocationReviewHash ?? undefined } : {}), confirmUnallocatedCredit: value.creditConfirmed, method: value.method, receivedAt, effectiveAt: receivedAt, payerName: value.payerName.trim() || null, externalReference: value.reference.trim() || null, note: value.note.trim() || null };
    try { await recordMutation.mutateAsync({ ...command, idempotencyKey: stableKey(keyRef, command) }); await invalidateFinanceReadModels(queryClient, "payment"); props.onClose(); }
    catch (error) { await auditAmbiguous(keyRef, queryClient); form.setFieldValue("finalConfirming", false); form.setErrorMap({ onSubmit: { fields: {}, form: error instanceof Error ? `${error.message} Authoritative finance views were refreshed; an unchanged retry reuses its key.` : "The payment outcome is uncertain. Review the refreshed finance state." } }); }
  }
  return <FormGuardedDialog form={form} onClose={props.onClose}>{(requestClose) => <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>Record payment</DialogTitle><DialogDescription>Allocate across as many as 500 outstanding bills, including earlier sessions with the same currency.</DialogDescription></DialogHeader><form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}><SessionField form={form} sessions={props.sessions} resetFields={["receivedAt", "allocations", "billSearch"]} /><PaymentFields form={form} /><form.Field name="allocationMode">{(field) => <div className="flex flex-col gap-1.5"><Label htmlFor="payment-allocation-mode">Allocation</Label><Select value={field.state.value} onValueChange={(value) => { field.handleChange(value as Value["allocationMode"]); form.setFieldValue("allocations", []); }}><SelectTrigger id="payment-allocation-mode" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="proposal">Oldest bills first</SelectItem><SelectItem value="explicit">Choose multiple bills</SelectItem><SelectItem value="unallocated">Keep as account credit</SelectItem></SelectContent></Select><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field><form.Subscribe selector={(state) => ({ mode: state.values.allocationMode, sessionId: state.values.sessionId, values: state.values.allocations, search: state.values.billSearch, page: state.values.billPage })}>{({ mode, sessionId, values, search, page }) => mode === "explicit" ? <ExplicitAllocations key={`${sessionId}-${search}-${page}`} form={form} schoolId={props.schoolId} admissionId={props.admissionId} session={sessionFor(props.sessions, sessionId)} values={values} search={search} page={page} /> : null}</form.Subscribe>{preview ? <div className="flex flex-col gap-3 rounded-xl border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium">Allocation preview</p><p className="text-xs text-muted-foreground">{preview.allocations.length} bills · {formatMinor(preview.allocatedMinor, preview.currency)} allocated</p></div><Badge variant="outline">{formatMinor(preview.unallocatedCreditMinor, preview.currency)} account credit</Badge></div>{preview.allocations.map((allocation) => <div key={allocation.billId} className="flex items-center justify-between gap-3 border-t pt-2 text-sm"><div><p className="font-mono">{allocation.billNumber}</p><p className="text-xs text-muted-foreground">{allocation.sessionLabel} · {formatMinor(allocation.outstandingMinor, preview.currency)} outstanding</p></div><span>{formatMinor(allocation.amountMinor, preview.currency)}</span></div>)}<form.Subscribe selector={(state) => state.values}>{(values) => <Button type="button" disabled={!preview.readyToRecord || recordMutation.isPending} onClick={() => requestRecord(values)}>Record reviewed payment</Button>}</form.Subscribe></div> : null}<SubmitFooter form={form} label={preview ? "Refresh allocation" : "Preview allocation"} pendingLabel="Previewing…" requestClose={requestClose} /></form><form.Subscribe selector={(state) => ({ values: state.values, creditConfirming: state.values.creditConfirming, finalConfirming: state.values.finalConfirming })}>{({ values, creditConfirming, finalConfirming }) => <><AlertDialog open={creditConfirming} onOpenChange={(open) => form.setFieldValue("creditConfirming", open)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Keep overpayment as account credit?</AlertDialogTitle><AlertDialogDescription>{preview ? `${formatMinor(preview.unallocatedCreditMinor, preview.currency)} will remain as lifetime unallocated account credit.` : "The remainder will remain as account credit."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Review allocation</AlertDialogCancel><AlertDialogAction onClick={(event) => { event.preventDefault(); form.setFieldValue("creditConfirming", false); form.setFieldValue("creditConfirmed", true); form.setFieldValue("finalConfirming", true); }}>Confirm account credit</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog><AlertDialog open={finalConfirming} onOpenChange={(open) => form.setFieldValue("finalConfirming", open)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Record this payment?</AlertDialogTitle><AlertDialogDescription>This creates an immutable receipt and the reviewed allocations.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep reviewing</AlertDialogCancel><AlertDialogAction disabled={recordMutation.isPending} onClick={(event) => { event.preventDefault(); void record(values); }}>{recordMutation.isPending ? "Recording…" : "Record payment"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>}</form.Subscribe></DialogContent>}</FormGuardedDialog>;
}
