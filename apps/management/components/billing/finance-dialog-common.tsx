"use client";

import { useState, type ReactNode } from "react";
import type { AnyFieldApi } from "@tanstack/react-form";
import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { civilDateInTimeZone, civilDateTimeInTimeZone, financeAmountError, financeDateTimeError, idempotencyForDraft, markIdempotencyAmbiguous, type IdempotencyDraftState } from "@campuspilot/components/finance";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@campuspilot/ui/components/alert-dialog";
import { Button } from "@campuspilot/ui/components/button";
import { Dialog, DialogFooter } from "@campuspilot/ui/components/dialog";
import { Label } from "@campuspilot/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@campuspilot/ui/components/select";
import { DirtyGuard } from "@/components/exam/exam-common";
import { invalidateFinanceReadModels } from "./finance-invalidation";
import { FieldErrors } from "./finance-ui";

export type FinanceSessionOption = { id: string; label: string; currency: string; timeZone: string; feeElements: Array<{ slug: string; name: string }> };
export type FinanceDialogBaseProps = { schoolId: string; admissionId: string; sessions: FinanceSessionOption[]; defaultSessionId: string; onClose: () => void };
export type PaymentMethod = "cash" | "bank_transfer" | "card" | "cheque" | "other";
export const paymentMethods: PaymentMethod[] = ["cash", "bank_transfer", "card", "cheque", "other"];
export const idSchema = z.string().trim().min(1, "Choose an option.");
export const dateTimeSchema = z.string().min(1, "Choose a date and time.");
export const positiveDecimalSchema = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/, "Enter a positive plain decimal amount.").refine((value) => /[1-9]/.test(value), "Amount must be greater than zero.");

export function sessionFor(sessions: FinanceSessionOption[], sessionId: string) {
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) throw new Error("Finance is not configured for the selected session.");
  return session;
}

export function validateMoney(sessions: FinanceSessionOption[], sessionId: string, amount: string, context: z.RefinementCtx, path: Array<string | number>) {
  if (!positiveDecimalSchema.safeParse(amount).success) return;
  const session = sessions.find((item) => item.id === sessionId);
  const message = session ? financeAmountError(amount, session.currency) : "Choose an accounting session.";
  if (message) context.addIssue({ code: "custom", path, message });
}

export function validateDateTime(sessions: FinanceSessionOption[], sessionId: string, value: string, context: z.RefinementCtx, path: string) {
  if (!dateTimeSchema.safeParse(value).success) return;
  const session = sessions.find((item) => item.id === sessionId);
  const message = session ? financeDateTimeError(value, session.timeZone) : "Choose an accounting session.";
  if (message) context.addIssue({ code: "custom", path: [path], message });
}

export function stableKey(ref: React.MutableRefObject<IdempotencyDraftState | undefined>, command: unknown) {
  ref.current = idempotencyForDraft(ref.current, JSON.stringify(command), () => crypto.randomUUID());
  return ref.current.key;
}

export async function auditAmbiguous(ref: React.MutableRefObject<IdempotencyDraftState | undefined>, queryClient: QueryClient) {
  if (ref.current) ref.current = markIdempotencyAmbiguous(ref.current);
  await invalidateFinanceReadModels(queryClient, "reversal");
}

function GuardedDialog({ dirty, onClose, children }: { dirty: boolean; onClose: () => void; children: (requestClose: () => void) => ReactNode }) {
  const [discardOpen, setDiscardOpen] = useState(false);
  const requestClose = () => dirty ? setDiscardOpen(true) : onClose();
  return <><DirtyGuard dirty={dirty} description="Your unsaved finance command will be lost." /><Dialog open onOpenChange={(open) => { if (!open) requestClose(); }}>{children(requestClose)}</Dialog><AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Discard finance draft?</AlertDialogTitle><AlertDialogDescription>Your unsaved finance command will be lost.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={onClose}>Discard draft</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>;
}

export function FormGuardedDialog({ form, onClose, children }: { form: any; onClose: () => void; children: (requestClose: () => void) => ReactNode }) {
  return <form.Subscribe selector={(state: any) => state.isDirty}>{(dirty: boolean) => <GuardedDialog dirty={dirty} onClose={onClose}>{children}</GuardedDialog>}</form.Subscribe>;
}

export function SessionField({ form, sessions, resetFields = [] }: { form: any; sessions: FinanceSessionOption[]; resetFields?: string[] }) {
  return <form.Field name="sessionId">{(field: AnyFieldApi) => <div className="flex flex-col gap-1.5"><Label htmlFor="finance-session">Accounting session</Label><Select value={String(field.state.value)} onValueChange={(value) => { const session = sessionFor(sessions, value); field.handleChange(value); resetFields.forEach((name) => form.setFieldValue(name, "")); if (resetFields.includes("effectiveAt")) form.setFieldValue("effectiveAt", civilDateTimeInTimeZone(session.timeZone)); if (resetFields.includes("receivedAt")) form.setFieldValue("receivedAt", civilDateTimeInTimeZone(session.timeZone)); if (resetFields.includes("issueDate")) form.setFieldValue("issueDate", civilDateInTimeZone(session.timeZone)); if (resetFields.includes("allocations")) form.setFieldValue("allocations", []); }}><SelectTrigger id="finance-session" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{sessions.map((session) => <SelectItem key={session.id} value={session.id}>{session.label} · {session.currency}</SelectItem>)}</SelectContent></Select><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field>;
}

export function MethodField({ form, id }: { form: any; id: string }) {
  return <form.Field name="method">{(field: AnyFieldApi) => <div className="flex flex-col gap-1.5"><Label htmlFor={id}>Method</Label><Select value={String(field.state.value)} onValueChange={field.handleChange}><SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger><SelectContent>{paymentMethods.map((method) => <SelectItem key={method} value={method}>{method.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field>;
}

export function SubmitFooter({ form, label, pendingLabel, requestClose, destructive = false }: { form: any; label: string; pendingLabel: string; requestClose: () => void; destructive?: boolean }) {
  return <form.Subscribe selector={(state: any) => ({ canSubmit: state.canSubmit, errors: state.errors, isSubmitting: state.isSubmitting })}>{({ canSubmit, errors, isSubmitting }: any) => <><FieldErrors errors={errors} /><DialogFooter><Button type="button" variant="outline" disabled={isSubmitting} onClick={requestClose}>Cancel</Button><Button type="submit" variant={destructive ? "destructive" : "default"} disabled={!canSubmit || isSubmitting}>{isSubmitting ? pendingLabel : label}</Button></DialogFooter></>}</form.Subscribe>;
}
