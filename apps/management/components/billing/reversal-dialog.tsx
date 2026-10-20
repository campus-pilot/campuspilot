"use client";

import { useRef } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { civilDateTimeInTimeZone, financeDateTimeError, formatMinor, instantFromCivilDateTime, reversalActionForEntry, type IdempotencyDraftState } from "@campuspilot/components/finance";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@campuspilot/ui/components/alert-dialog";
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@campuspilot/ui/components/dialog";
import { Input } from "@campuspilot/ui/components/input";
import { Label } from "@campuspilot/ui/components/label";
import { Textarea } from "@campuspilot/ui/components/textarea";
import { client } from "@/lib/orpc";
import { invalidateFinanceReadModels } from "./finance-invalidation";
import { FieldErrors } from "./finance-ui";
import { auditAmbiguous, dateTimeSchema, FormGuardedDialog, sessionFor, stableKey, SubmitFooter, type FinanceDialogBaseProps } from "./finance-dialog-common";

const baseSchema = z.object({ reason: z.string().trim().min(1, "Explain this reversal."), effectiveAt: dateTimeSchema, confirming: z.boolean() });

export function ReversalDialog(props: FinanceDialogBaseProps & { entry: { id: string; sessionId: string; amountMinor: string; currency: string; reference: string; type: string; billId?: string } }) {
  const queryClient = useQueryClient();
  const keyRef = useRef<IdempotencyDraftState>(undefined);
  const session = sessionFor(props.sessions, props.entry.sessionId);
  const target = reversalActionForEntry(props.entry.type);
  const mutation = useMutation({ mutationFn: (input: any): Promise<unknown> => target === "bill" ? client.school.reverseBill(input) : client.school.reverseLedgerEntry(input) });
  const schema = baseSchema.superRefine((value, context) => { const message = financeDateTimeError(value.effectiveAt, session.timeZone); if (message) context.addIssue({ code: "custom", path: ["effectiveAt"], message }); });
  type Value = z.infer<typeof schema>;
  const form = useForm({ defaultValues: { reason: "", effectiveAt: civilDateTimeInTimeZone(session.timeZone), confirming: false }, validators: { onSubmit: schema }, onSubmit: async () => form.setFieldValue("confirming", true) });
  async function confirm(value: Value) {
    const parsed = schema.safeParse(value);
    if (!parsed.success) return;
    const base = { schoolId: props.schoolId, admissionId: props.admissionId, sessionId: props.entry.sessionId, reason: parsed.data.reason, effectiveAt: instantFromCivilDateTime(parsed.data.effectiveAt, session.timeZone) };
    if (target === "bill" && !props.entry.billId) { form.setErrorMap({ onSubmit: { fields: {}, form: "The selected bill target is unavailable." } }); return; }
    const command = target === "bill" ? { ...base, billId: props.entry.billId! } : { ...base, ledgerEntryId: props.entry.id };
    try { await mutation.mutateAsync({ ...command, idempotencyKey: stableKey(keyRef, command) }); await invalidateFinanceReadModels(queryClient, "reversal"); props.onClose(); }
    catch (error) { await auditAmbiguous(keyRef, queryClient); form.setFieldValue("confirming", false); form.setErrorMap({ onSubmit: { fields: {}, form: error instanceof Error ? error.message : "Unable to reverse this finance fact." } }); }
  }
  return <FormGuardedDialog form={form} onClose={props.onClose}>{(requestClose) => <DialogContent><DialogHeader><DialogTitle>Reverse {props.entry.reference}?</DialogTitle><DialogDescription>{props.entry.type.replaceAll("_", " ")} · {formatMinor(props.entry.amountMinor, props.entry.currency)}. The selected operation is the locked reversal target.</DialogDescription></DialogHeader><form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}><form.Field name="reason">{(field) => <div className="flex flex-col gap-1.5"><Label htmlFor="reversal-reason">Reason</Label><Textarea id="reversal-reason" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} /><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field><form.Field name="effectiveAt">{(field) => <div className="flex flex-col gap-1.5"><Label htmlFor="reversal-effective">Effective at</Label><Input id="reversal-effective" type="datetime-local" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} /><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field><SubmitFooter form={form} label="Review reversal" pendingLabel="Reviewing…" requestClose={requestClose} destructive /></form><form.Subscribe selector={(state) => ({ confirming: state.values.confirming, values: state.values })}>{({ confirming, values }) => <AlertDialog open={confirming} onOpenChange={(open) => form.setFieldValue("confirming", open)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Confirm immutable reversal?</AlertDialogTitle><AlertDialogDescription>{props.entry.reference} for {formatMinor(props.entry.amountMinor, props.entry.currency)} will receive an opposite posting.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={mutation.isPending} onClick={(event) => { event.preventDefault(); void confirm(values); }}>{mutation.isPending ? "Reversing…" : "Reverse selected operation"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}</form.Subscribe></DialogContent>}</FormGuardedDialog>;
}
