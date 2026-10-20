"use client";

import { useRef } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { civilDateInTimeZone, decimalToMinor, type IdempotencyDraftState } from "@campuspilot/components/finance";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@campuspilot/ui/components/alert-dialog";
import { Input } from "@campuspilot/ui/components/input";
import { Label } from "@campuspilot/ui/components/label";
import { Textarea } from "@campuspilot/ui/components/textarea";
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@campuspilot/ui/components/dialog";
import { client } from "@/lib/orpc";
import { invalidateFinanceReadModels } from "./finance-invalidation";
import { FieldErrors } from "./finance-ui";
import { auditAmbiguous, FormGuardedDialog, idSchema, positiveDecimalSchema, SessionField, sessionFor, stableKey, SubmitFooter, validateMoney, type FinanceDialogBaseProps } from "./finance-dialog-common";

export function ManualBillDialog(props: FinanceDialogBaseProps) {
  const queryClient = useQueryClient();
  const keyRef = useRef<IdempotencyDraftState>(undefined);
  const mutation = useMutation({ mutationFn: (input: any) => client.school.createManualBill(input) });
  const initial = sessionFor(props.sessions, props.defaultSessionId);
  const schema = z.object({ sessionId: idSchema, issueDate: z.string().date("Choose an issue date."), title: z.string().trim().min(1, "Enter the item or charge title.").max(200), amount: positiveDecimalSchema, reason: z.string().trim().min(1, "Explain why this manual charge is being created.").max(1000), confirming: z.boolean() }).superRefine((value, context) => validateMoney(props.sessions, value.sessionId, value.amount, context, ["amount"]));
  type Value = z.infer<typeof schema>;
  const form = useForm({ defaultValues: { sessionId: initial.id, issueDate: civilDateInTimeZone(initial.timeZone), title: "", amount: "", reason: "", confirming: false }, validators: { onSubmit: schema }, onSubmit: async () => form.setFieldValue("confirming", true) });

  async function confirm(value: Value) {
    const parsed = schema.safeParse(value);
    if (!parsed.success) return;
    const session = sessionFor(props.sessions, parsed.data.sessionId);
    const command = { schoolId: props.schoolId, admissionId: props.admissionId, sessionId: session.id, issueDate: parsed.data.issueDate, reason: parsed.data.reason, lines: [{ title: parsed.data.title, amountMinor: decimalToMinor(parsed.data.amount, session.currency) }] };
    try {
      await mutation.mutateAsync({ ...command, idempotencyKey: stableKey(keyRef, command) });
      await invalidateFinanceReadModels(queryClient, "manual_bill");
      props.onClose();
    } catch (error) {
      await auditAmbiguous(keyRef, queryClient);
      form.setFieldValue("confirming", false);
      form.setErrorMap({ onSubmit: { fields: {}, form: error instanceof Error ? error.message : "Unable to post this manual bill." } });
    }
  }

  return <FormGuardedDialog form={form} onClose={props.onClose}>{(requestClose) => <DialogContent><DialogHeader><DialogTitle>Create manual bill</DialogTitle><DialogDescription>Add a one-off item that is not tied to the configured fee structure.</DialogDescription></DialogHeader><form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}><SessionField form={form} sessions={props.sessions} resetFields={["issueDate"]} /><form.Field name="title">{(field) => <div className="flex flex-col gap-1.5"><Label htmlFor="manual-title">Item or title</Label><Input id="manual-title" placeholder="For example, replacement library book" value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} /><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field><div className="grid gap-3 sm:grid-cols-2"><form.Field name="amount">{(field) => <div className="flex flex-col gap-1.5"><Label htmlFor="manual-amount">Amount</Label><Input id="manual-amount" inputMode="decimal" value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} /><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field><form.Field name="issueDate">{(field) => <div className="flex flex-col gap-1.5"><Label htmlFor="manual-date">Issue date</Label><Input id="manual-date" type="date" value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} /><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field></div><form.Field name="reason">{(field) => <div className="flex flex-col gap-1.5"><Label htmlFor="manual-reason">Reason (required)</Label><Textarea id="manual-reason" placeholder="Explain why this charge was created for the audit record" value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} /><p className="text-xs text-muted-foreground">This explanation is retained with the immutable bill and ledger entry.</p><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field><SubmitFooter form={form} label="Review manual bill" pendingLabel="Reviewing…" requestClose={requestClose} /></form><form.Subscribe selector={(state) => ({ confirming: state.values.confirming, values: state.values })}>{({ confirming, values }) => <AlertDialog open={confirming} onOpenChange={(open) => form.setFieldValue("confirming", open)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Post this manual bill?</AlertDialogTitle><AlertDialogDescription>This creates the immutable “{values.title.trim() || "Untitled item"}” charge for the selected admission.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction disabled={mutation.isPending} onClick={(event) => { event.preventDefault(); void confirm(values); }}>{mutation.isPending ? "Posting…" : "Post manual bill"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}</form.Subscribe></DialogContent>}</FormGuardedDialog>;
}
