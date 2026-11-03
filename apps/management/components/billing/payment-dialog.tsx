"use client";

import { useRef } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { civilDateTimeInTimeZone, decimalToMinor, formatMinor, instantFromCivilDateTime, type IdempotencyDraftState } from "@campuspilot/components/finance";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@campuspilot/ui/components/alert-dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@campuspilot/ui/components/accordion";
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@campuspilot/ui/components/dialog";
import { Input } from "@campuspilot/ui/components/input";
import { Label } from "@campuspilot/ui/components/label";
import { Textarea } from "@campuspilot/ui/components/textarea";
import { client } from "@/lib/orpc";
import { invalidateFinanceReadModels } from "./finance-invalidation";
import { FieldErrors } from "./finance-ui";
import { auditAmbiguous, dateTimeSchema, FormGuardedDialog, idSchema, manualReasonCode, MethodField, paymentMethods, positiveDecimalSchema, SessionField, sessionFor, stableKey, SubmitFooter, validateDateTime, validateMoney, type FinanceDialogBaseProps, type PaymentMethod } from "./finance-dialog-common";

const baseSchema = z.object({
  sessionId: idSchema,
  amount: positiveDecimalSchema,
  method: z.enum(paymentMethods),
  receivedAt: dateTimeSchema,
  payerName: z.string(),
  reference: z.string(),
  note: z.string(),
  discountAmount: z.string(),
  discountReasonCode: z.string(),
  discountReasonNote: z.string(),
  addNote: z.boolean(),
  addDiscount: z.boolean(),
  confirming: z.boolean(),
});

function paymentAmountLabel(value: string, currency: string) {
  try {
    return formatMinor(decimalToMinor(value || "0", currency), currency);
  } catch {
    return "the entered amount";
  }
}

function PaymentFields({ form, sessions }: { form: any; sessions: FinanceDialogBaseProps["sessions"] }) {
  return <><div className="grid gap-3 sm:grid-cols-2"><SessionField form={form} sessions={sessions} resetFields={["receivedAt"]} hideCurrency /><MethodField form={form} id="payment-method" /></div><form.Field name="amount">{(field: any) => <div className="flex flex-col gap-1.5"><Label htmlFor="payment-amount">Amount</Label><Input id="payment-amount" inputMode="decimal" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} /><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field><div className="grid gap-3 sm:grid-cols-2"><form.Field name="receivedAt">{(field: any) => <div className="flex flex-col gap-1.5"><Label htmlFor="payment-received">Received at</Label><Input id="payment-received" type="datetime-local" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} /><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field><form.Field name="payerName">{(field: any) => <div className="flex flex-col gap-1.5"><Label htmlFor="payment-payer">Payer name (optional)</Label><Input id="payment-payer" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} /><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field></div><section aria-label="Optional payment details" className="rounded-lg border bg-card"><form.Subscribe selector={(state: any) => ({ addDiscount: state.values.addDiscount, addNote: state.values.addNote })}>{({ addDiscount, addNote }: { addDiscount: boolean; addNote: boolean }) => <Accordion type="multiple" value={[...(addNote ? ["note"] : []), ...(addDiscount ? ["discount"] : [])]} onValueChange={(value) => { form.setFieldValue("addNote", value.includes("note")); form.setFieldValue("addDiscount", value.includes("discount")); }} className="border-0"><AccordionItem value="note"><AccordionTrigger className="p-3 text-sm">Add note</AccordionTrigger><AccordionContent className="px-3"><form.Field name="note">{(field: any) => <div className="flex flex-col gap-1.5"><Label htmlFor="payment-note">Note</Label><Textarea id="payment-note" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} /><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field></AccordionContent></AccordionItem><AccordionItem value="discount"><AccordionTrigger className="p-3 text-sm">Add discount</AccordionTrigger><AccordionContent className="px-3"><div className="grid gap-3 sm:grid-cols-2"><form.Field name="discountAmount">{(field: any) => <div className="flex flex-col gap-1.5"><Label htmlFor="payment-discount">Discount amount</Label><Input id="payment-discount" inputMode="decimal" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} /><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field><form.Field name="discountReasonNote">{(field: any) => <div className="flex flex-col gap-1.5"><Label htmlFor="payment-discount-note">Discount reason</Label><Input id="payment-discount-note" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} /><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field></div></AccordionContent></AccordionItem></Accordion>}</form.Subscribe></section></>;
}

export function PaymentDialog(props: FinanceDialogBaseProps) {
  const queryClient = useQueryClient();
  const keyRef = useRef<IdempotencyDraftState>(undefined);
  const initial = sessionFor(props.sessions, props.defaultSessionId);
  const recordMutation = useMutation({ mutationFn: (input: any) => client.school.recordPayment(input) });
  const schema = baseSchema.superRefine((value, context) => {
    validateMoney(props.sessions, value.sessionId, value.amount, context, ["amount"]);
    validateDateTime(props.sessions, value.sessionId, value.receivedAt, context, "receivedAt");
    if (value.addDiscount) {
      validateMoney(props.sessions, value.sessionId, value.discountAmount, context, ["discountAmount"]);
      if (!value.discountReasonNote.trim()) context.addIssue({ code: "custom", path: ["discountReasonNote"], message: "Enter a discount reason." });
    }
  });
  type Value = z.infer<typeof schema>;
  const form = useForm({
    defaultValues: { sessionId: initial.id, amount: "", method: "cash" as PaymentMethod, receivedAt: civilDateTimeInTimeZone(initial.timeZone), payerName: "", reference: "", note: "", addNote: false, addDiscount: false, discountAmount: "", discountReasonCode: manualReasonCode, discountReasonNote: "", confirming: false },
    validators: { onSubmit: schema },
    onSubmit: async () => form.setFieldValue("confirming", true),
  });

  async function record(value: Value) {
    const session = sessionFor(props.sessions, value.sessionId);
    const receivedAt = instantFromCivilDateTime(value.receivedAt, session.timeZone);
    const command = { schoolId: props.schoolId, admissionId: props.admissionId, sessionId: session.id, currency: session.currency, amountMinor: decimalToMinor(value.amount, session.currency), method: value.method, receivedAt, effectiveAt: receivedAt, payerName: value.payerName.trim() || null, externalReference: value.reference.trim() || null, note: value.note.trim() || null, ...(value.addDiscount ? { discount: { amountMinor: decimalToMinor(value.discountAmount, session.currency), reasonCode: value.discountReasonCode.trim(), reasonNote: value.discountReasonNote.trim() } } : {}) };
    try {
      const input = { ...command, idempotencyKey: stableKey(keyRef, command) };
      if (value.addDiscount) {
        await client.school.recordPaymentWithDiscount({ ...input, discount: { amountMinor: decimalToMinor(value.discountAmount, session.currency), reasonCode: value.discountReasonCode.trim(), reasonNote: value.discountReasonNote.trim() } });
      } else {
        await recordMutation.mutateAsync(input);
      }
      await invalidateFinanceReadModels(queryClient, "payment");
      props.onClose();
    } catch (error) {
      await auditAmbiguous(keyRef, queryClient);
      form.setFieldValue("confirming", false);
      form.setErrorMap({ onSubmit: { fields: {}, form: error instanceof Error ? `${error.message} Authoritative finance views were refreshed; an unchanged retry reuses its key.` : "The payment outcome is uncertain. Review the refreshed finance state." } });
    }
  }

  return <FormGuardedDialog form={form} onClose={props.onClose}>{(requestClose) => <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Record payment</DialogTitle><DialogDescription>Record money received as a credit on this admission account. The payment is not assigned to any individual bill.</DialogDescription></DialogHeader><form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}><PaymentFields form={form} sessions={props.sessions} /><SubmitFooter form={form} label="Review payment" pendingLabel="Reviewing…" requestClose={requestClose} /></form><form.Subscribe selector={(state) => ({ values: state.values, confirming: state.values.confirming })}>{({ values, confirming }) => { const session = sessionFor(props.sessions, values.sessionId); return <AlertDialog open={confirming} onOpenChange={(open) => form.setFieldValue("confirming", open)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Record this payment?</AlertDialogTitle><AlertDialogDescription>{`${paymentAmountLabel(values.amount, session.currency)} will be added as an account credit. It will reduce the admission's total due balance without settling a specific bill.`}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction disabled={recordMutation.isPending} onClick={(event) => { event.preventDefault(); void record(values); }}>{recordMutation.isPending ? "Recording…" : "Record payment"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>; }}</form.Subscribe></DialogContent>}</FormGuardedDialog>;
}
