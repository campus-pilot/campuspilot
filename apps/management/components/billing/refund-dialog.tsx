"use client";

import { useRef } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { civilDateTimeInTimeZone, decimalToMinor, financeAmountError, financeDateTimeError, formatMinor, instantFromCivilDateTime, type IdempotencyDraftState } from "@campuspilot/components/finance";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@campuspilot/ui/components/alert-dialog";
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@campuspilot/ui/components/dialog";
import { Input } from "@campuspilot/ui/components/input";
import { Label } from "@campuspilot/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@campuspilot/ui/components/select";
import { Textarea } from "@campuspilot/ui/components/textarea";
import { client, orpc } from "@/lib/orpc";
import { invalidateFinanceReadModels } from "./finance-invalidation";
import { FieldErrors, FinanceError, FinanceLoading, SimplePagination } from "./finance-ui";
import { auditAmbiguous, dateTimeSchema, FormGuardedDialog, idSchema, MethodField, paymentMethods, positiveDecimalSchema, SessionField, sessionFor, stableKey, SubmitFooter, type FinanceDialogBaseProps, type PaymentMethod } from "./finance-dialog-common";

const baseSchema = z.object({ sessionId: idSchema, paymentId: idSchema, paymentSessionId: idSchema, paymentCurrency: idSchema, receiptLabel: z.string(), paymentPage: z.number().int().positive(), amount: positiveDecimalSchema, method: z.enum(paymentMethods), reference: z.string(), reason: z.string().trim().min(1, "Explain this refund."), effectiveAt: dateTimeSchema, confirming: z.boolean() });

function RefundPaymentField({ form, schoolId, admissionId, sessionId, page, selectedId, selectedLabel }: { form: any; schoolId: string; admissionId: string; sessionId: string; page: number; selectedId: string; selectedLabel: string }) {
  const query = useQuery(orpc.school.listPayments.queryOptions({ input: { schoolId, page, limit: 20, filters: { admissionId, sessionId } } }));
  if (query.isPending) return <FinanceLoading rows={1} />;
  if (query.isError) return <FinanceError title="Unable to load refundable payments" error={query.error} />;
  const refundable = query.data.items.filter((payment) => !payment.reversed && BigInt(payment.refundableMinor) > BigInt(0));
  return <form.Field name="paymentId">{(field: any) => <div className="flex flex-col gap-1.5"><Label htmlFor="refund-payment">Refundable receipt</Label><Select value={field.state.value} onValueChange={(value) => { const payment = refundable.find((item) => item.id === value); field.handleChange(value); if (payment) { form.setFieldValue("paymentSessionId", payment.sessionId); form.setFieldValue("paymentCurrency", payment.currency); form.setFieldValue("receiptLabel", payment.receiptNumber); } }}><SelectTrigger id="refund-payment" className="w-full"><SelectValue placeholder="Choose receipt" /></SelectTrigger><SelectContent>{selectedId && !refundable.some(({ id }) => id === selectedId) ? <SelectItem value={selectedId}>{selectedLabel}</SelectItem> : null}{refundable.map((payment) => <SelectItem key={payment.id} value={payment.id}>{payment.receiptNumber} · {formatMinor(payment.refundableMinor, payment.currency)} refundable</SelectItem>)}</SelectContent></Select><FieldErrors errors={field.state.meta.errors} /><SimplePagination currentPage={query.data.pagination.currentPage} totalPages={query.data.pagination.totalPages} onPageChange={(next) => { form.setFieldValue("paymentPage", next); form.setFieldValue("paymentId", ""); form.setFieldValue("paymentSessionId", ""); form.setFieldValue("paymentCurrency", ""); form.setFieldValue("receiptLabel", ""); }} /></div>}</form.Field>;
}

export function RefundDialog(props: FinanceDialogBaseProps) {
  const queryClient = useQueryClient();
  const keyRef = useRef<IdempotencyDraftState>(undefined);
  const initial = sessionFor(props.sessions, props.defaultSessionId);
  const mutation = useMutation({ mutationFn: (input: any) => client.school.recordRefund(input) });
  const schema = baseSchema.superRefine((value, context) => {
    const paymentSession = props.sessions.find(({ id }) => id === value.paymentSessionId);
    const amountError = value.paymentCurrency ? financeAmountError(value.amount, value.paymentCurrency) : undefined;
    if (amountError) context.addIssue({ code: "custom", path: ["amount"], message: amountError });
    const dateError = paymentSession ? financeDateTimeError(value.effectiveAt, paymentSession.timeZone) : "Choose a refundable payment.";
    if (dateError) context.addIssue({ code: "custom", path: ["effectiveAt"], message: dateError });
  });
  type Value = z.infer<typeof schema>;
  const form = useForm({ defaultValues: { sessionId: initial.id, paymentId: "", paymentSessionId: "", paymentCurrency: "", receiptLabel: "", paymentPage: 1, amount: "", method: "cash" as PaymentMethod, reference: "", reason: "", effectiveAt: civilDateTimeInTimeZone(initial.timeZone), confirming: false }, validators: { onSubmit: schema }, onSubmit: async () => form.setFieldValue("confirming", true) });
  async function confirm(value: Value) {
    const parsed = schema.safeParse(value);
    if (!parsed.success) return;
    const session = sessionFor(props.sessions, parsed.data.paymentSessionId);
    const command = { schoolId: props.schoolId, admissionId: props.admissionId, sessionId: parsed.data.paymentSessionId, paymentId: parsed.data.paymentId, amountMinor: decimalToMinor(parsed.data.amount, parsed.data.paymentCurrency), method: parsed.data.method, externalReference: parsed.data.reference.trim() || null, reason: parsed.data.reason, effectiveAt: instantFromCivilDateTime(parsed.data.effectiveAt, session.timeZone) };
    try { await mutation.mutateAsync({ ...command, idempotencyKey: stableKey(keyRef, command) }); await invalidateFinanceReadModels(queryClient, "refund"); props.onClose(); }
    catch (error) { await auditAmbiguous(keyRef, queryClient); form.setFieldValue("confirming", false); form.setErrorMap({ onSubmit: { fields: {}, form: error instanceof Error ? error.message : "Unable to record this refund." } }); }
  }
  return <FormGuardedDialog form={form} onClose={props.onClose}>{(requestClose) => <DialogContent><DialogHeader><DialogTitle>Record refund</DialogTitle><DialogDescription>Select a recorded receipt; its session and currency remain authoritative.</DialogDescription></DialogHeader><form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}><SessionField form={form} sessions={props.sessions} resetFields={["effectiveAt", "paymentId", "paymentSessionId", "paymentCurrency", "receiptLabel"]} /><form.Subscribe selector={(state) => ({ sessionId: state.values.sessionId, page: state.values.paymentPage, selectedId: state.values.paymentId, selectedLabel: state.values.receiptLabel })}>{(values) => <RefundPaymentField key={`${values.sessionId}-${values.page}`} form={form} schoolId={props.schoolId} admissionId={props.admissionId} {...values} />}</form.Subscribe><div className="grid gap-3 sm:grid-cols-2"><form.Field name="amount">{(field) => <div className="flex flex-col gap-1.5"><Label htmlFor="refund-amount">Amount</Label><Input id="refund-amount" inputMode="decimal" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} /><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field><MethodField form={form} id="refund-method" /></div><form.Field name="reference">{(field) => <div className="flex flex-col gap-1.5"><Label htmlFor="refund-reference">External reference (optional)</Label><Input id="refund-reference" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} /><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field><form.Field name="reason">{(field) => <div className="flex flex-col gap-1.5"><Label htmlFor="refund-reason">Reason</Label><Textarea id="refund-reason" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} /><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field><form.Field name="effectiveAt">{(field) => <div className="flex flex-col gap-1.5"><Label htmlFor="refund-effective">Effective at</Label><Input id="refund-effective" type="datetime-local" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} /><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field><SubmitFooter form={form} label="Review refund" pendingLabel="Reviewing…" requestClose={requestClose} destructive /></form><form.Subscribe selector={(state) => ({ confirming: state.values.confirming, values: state.values })}>{({ confirming, values }) => <AlertDialog open={confirming} onOpenChange={(open) => form.setFieldValue("confirming", open)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Record this refund?</AlertDialogTitle><AlertDialogDescription>This creates an immutable debit posting against {values.receiptLabel || "the selected receipt"}.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={mutation.isPending} onClick={(event) => { event.preventDefault(); void confirm(values); }}>{mutation.isPending ? "Refunding…" : "Record refund"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}</form.Subscribe></DialogContent>}</FormGuardedDialog>;
}
