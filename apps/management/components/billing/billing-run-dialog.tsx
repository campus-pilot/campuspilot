"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { billingRunPreviewOutputSchema } from "@campuspilot/api/routers/school/billing/billing.dto";
import { civilDateInTimeZone, currencyExponent, financeAmountError, financeBillingDraftSchema, financeScopeIds, formatMinor, decimalToMinor, groupFinanceIssues, idempotencyForDraft, markIdempotencyAmbiguous, type FinanceScopeSelection, type IdempotencyDraftState } from "@campuspilot/components/finance";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@campuspilot/ui/components/alert-dialog";
import { Badge } from "@campuspilot/ui/components/badge";
import { Button } from "@campuspilot/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@campuspilot/ui/components/dialog";
import { Input } from "@campuspilot/ui/components/input";
import { Label } from "@campuspilot/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@campuspilot/ui/components/select";
import { Textarea } from "@campuspilot/ui/components/textarea";
import { client, orpc } from "@/lib/orpc";
import { DirtyGuard } from "@/components/exam/exam-common";
import { FieldErrors, SimplePagination } from "./finance-ui";
import { invalidateFinanceReadModels } from "./finance-invalidation";

type RuntimeElement = {
  slug: string;
  name: string;
  scopes: Array<"school" | "class" | "student">;
};
type ScopeSelection = FinanceScopeSelection;
type BillingClass = { id: string; label: string };
type PreviewIssue = z.infer<typeof billingRunPreviewOutputSchema>["issues"]["items"][number];
type BillingPreview = z.infer<typeof billingRunPreviewOutputSchema>;

const formSchema = financeBillingDraftSchema;
type BillingFormValue = z.infer<typeof formSchema>;

/** Excludes selector search/pagination state from command identity. */
function commandDraft(value: BillingFormValue) {
  return {
    billingDate: value.billingDate,
    kind: value.kind,
    supplementalReason: value.kind === "supplemental" ? value.supplementalReason.trim() : "",
    classIds: value.classSelections.map(({ id }) => id).sort(),
    runValues: value.runValues,
  };
}

/** Converts editable major-unit values to the API's exact minor-unit shape. */
function billingRunValues(value: BillingFormValue, currency: string) {
  const selectedClassIds = value.classSelections.length
    ? new Set(value.classSelections.map(({ id }) => id))
    : null;
  const compactValues = (values: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(values)
        .filter(([, amount]) => amount.trim())
        .map(([slug, amount]) => [slug, decimalToMinor(amount, currency)]),
    );
  const classes = Object.fromEntries(
    Object.entries(value.runValues.classes)
      .filter(([classId]) => !selectedClassIds || selectedClassIds.has(classId))
      .map(([classId, values]) => [classId, compactValues(values)])
      .filter(([, values]) => Object.keys(values).length > 0),
  );

  return {
    session: compactValues(value.runValues.session),
    classes,
  };
}

/** An empty selection is the compact command representation for all classes. */
function selectedBillingClasses(
  classes: BillingClass[],
  values: ScopeSelection[],
) {
  if (!values.length) return classes;
  const selectedIds = new Set(values.map(({ id }) => id));
  return classes.filter(({ id }) => selectedIds.has(id));
}

function commandDraftFingerprint(value: unknown) {
  const parsed = formSchema.safeParse(value);
  return parsed.success ? JSON.stringify(commandDraft(parsed.data)) : null;
}

function ClassScopePicker({ classes, isPending, isError, values, search, page, onValuesChange, onSearchChange, onPageChange }: { classes: BillingClass[]; isPending: boolean; isError: boolean; values: ScopeSelection[]; search: string; page: number; onValuesChange: (values: ScopeSelection[]) => void; onSearchChange: (value: string) => void; onPageChange: (page: number) => void }) {
  const selectedClasses = selectedBillingClasses(classes, values);
  const selected = new Set(selectedClasses.map(({ id }) => id));
  const filteredClasses = classes.filter((item) => item.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filteredClasses.length / pageSize));
  const visible = filteredClasses.slice((page - 1) * pageSize, page * pageSize);

  function toggleClass(item: BillingClass) {
    const current = selectedBillingClasses(classes, values);
    const next = selected.has(item.id)
      ? current.filter(({ id }) => id !== item.id)
      : [...current, item];
    if (!next.length) return;
    onValuesChange(next.length === classes.length ? [] : next);
  }

  return <fieldset className="flex flex-col gap-2 rounded-xl border p-3"><legend className="px-1 text-sm font-medium">Classes</legend><div className="flex items-center justify-between gap-2"><p className="text-xs text-muted-foreground">{isPending ? "Loading classes…" : `${selectedClasses.length} of ${classes.length} classes selected`}</p>{values.length ? <Button type="button" size="xs" variant="outline" onClick={() => onValuesChange([])}>Select all</Button> : null}</div><Input value={search} placeholder="Search classes…" aria-label="Search classes for billing" onChange={(event) => { onSearchChange(event.target.value); onPageChange(1); }} />{isError ? <p className="text-xs text-destructive">Unable to load classes.</p> : <><div className="flex flex-col gap-1">{visible.map((item) => <Button key={item.id} type="button" size="sm" variant={selected.has(item.id) ? "secondary" : "ghost"} className="justify-between" onClick={() => toggleClass(item)}><span className="truncate">{item.label}</span><span>{selected.has(item.id) ? "Selected" : "Excluded"}</span></Button>)}</div><SimplePagination currentPage={page} totalPages={totalPages} onPageChange={onPageChange} /></>}</fieldset>;
}

function PreviewIssues({ issues, skippedCount }: { issues: PreviewIssue[]; skippedCount: number }) {
  const scopes = groupFinanceIssues(issues);
  const skipped = issues.filter((issue) => issue.scope === "admission" && issue.blocking);
  return <div className="flex flex-col gap-3"><h4 className="text-sm font-medium">Readiness issues</h4>{scopes.map(({ scope, items }) => <section key={scope} className="flex flex-col gap-1"><h5 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{scope}</h5>{items.map((issue, index) => <div key={`${issue.code}-${issue.entityId}-${index}`} className="flex items-start gap-2 rounded-lg bg-muted/50 p-2"><Badge variant={issue.blocking ? "destructive" : "outline"}>{issue.blocking ? "Blocking" : "Notice"}</Badge><div><p>{issue.entityLabel}</p><p className="text-xs text-muted-foreground">{issue.message}</p></div></div>)}</section>)}{skippedCount ? <div className="overflow-x-auto"><p className="mb-2 text-sm font-medium">Skipped records ({skippedCount})</p><table className="w-full min-w-[480px] text-xs"><thead><tr className="border-b text-left"><th className="p-2">Admission</th><th className="p-2">Reason</th></tr></thead><tbody>{skipped.map((issue, index) => <tr key={`${issue.entityId}-${index}`} className="border-b last:border-0"><td className="p-2 font-medium">{issue.entityLabel}</td><td className="p-2">{issue.message}</td></tr>)}</tbody></table>{skipped.length < skippedCount ? <p className="p-2 text-xs text-muted-foreground">This page shows {skipped.length} of {skippedCount} skipped records. Use issue pagination for the remaining records.</p> : null}</div> : null}</div>;
}

function BillingRunFields({ form, currency, amountPlaceholder, runtimeElements }: { form: any; currency: string; amountPlaceholder: string; runtimeElements: RuntimeElement[] }) {
  const sessionElements = runtimeElements.filter(
    ({ scopes }) => !scopes.includes("class"),
  );
  return <><div className="grid gap-3 sm:grid-cols-2"><form.Field name="billingDate">{(field: any) => <div className="flex flex-col gap-1.5"><Label htmlFor="billing-date">Billing date</Label><Input id="billing-date" type="date" value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} /><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field><form.Field name="kind">{(field: any) => <div className="flex flex-col gap-1.5"><Label htmlFor="billing-kind">Run type</Label><Select value={field.state.value} onValueChange={(value) => field.handleChange(value as "regular" | "supplemental")}><SelectTrigger id="billing-kind" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="regular">Regular</SelectItem><SelectItem value="supplemental">Supplemental</SelectItem></SelectContent></Select><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field></div><form.Subscribe selector={(state: any) => state.values.kind}>{(kind: string) => kind === "supplemental" ? <form.Field name="supplementalReason">{(field: any) => <div className="flex flex-col gap-1.5"><Label htmlFor="supplemental-reason">Supplemental reason</Label><Textarea id="supplemental-reason" value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} /><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field> : null}</form.Subscribe>{sessionElements.length ? <fieldset className="grid gap-3 rounded-xl border p-3 sm:grid-cols-2"><legend className="px-1 text-sm font-medium">School-wide run values</legend>{sessionElements.map((element) => <form.Field key={element.slug} name={`runValues.session.${element.slug}`}>{(field: any) => <div className="flex flex-col gap-1.5"><Label htmlFor={`run-session-${element.slug}`}>{element.name} ({currency})</Label><Input id={`run-session-${element.slug}`} inputMode="decimal" placeholder={amountPlaceholder} value={String(field.state.value ?? "")} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} /><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field>)}</fieldset> : null}</>;
}

function ClassRunValueFields({ form, classes, runtimeElements, currency, amountPlaceholder }: { form: any; classes: BillingClass[]; runtimeElements: RuntimeElement[]; currency: string; amountPlaceholder: string }) {
  if (!runtimeElements.length) return null;
  return <form.Subscribe selector={(state: any) => state.values.classSelections}>{(classSelections: ScopeSelection[]) => {
    const selectedClasses = selectedBillingClasses(classes, classSelections);
    return <fieldset className="flex flex-col gap-3 rounded-xl border p-3"><legend className="px-1 text-sm font-medium">Values by class</legend><p className="text-xs text-muted-foreground">Enter the amount to charge for each selected class. A blank value is resolved only when a student-specific value or configured default exists.</p><div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><thead><tr className="border-b text-left"><th className="p-2">Class</th>{runtimeElements.map((element) => <th key={element.slug} className="p-2">{element.name} ({currency})</th>)}</tr></thead><tbody>{selectedClasses.map((schoolClass) => <tr key={schoolClass.id} className="border-b last:border-0"><th scope="row" className="p-2 text-left font-medium">{schoolClass.label}</th>{runtimeElements.map((element) => <td key={element.slug} className="p-2"><form.Field name={`runValues.classes.${schoolClass.id}.${element.slug}`}>{(field: any) => <div className="flex min-w-36 flex-col gap-1"><Input aria-label={`${element.name} for ${schoolClass.label}`} inputMode="decimal" placeholder={amountPlaceholder} value={String(field.state.value ?? "")} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} /><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field></td>)}</tr>)}</tbody></table></div></fieldset>;
  }}</form.Subscribe>;
}

function BillingScopeFields({ form, schoolId, sessionId, currency, amountPlaceholder, runtimeElements }: { form: any; schoolId: string; sessionId: string; currency: string; amountPlaceholder: string; runtimeElements: RuntimeElement[] }) {
  const classesQuery = useQuery(orpc.school.listClasses.queryOptions({ input: { schoolId, sessionId } }));
  const classes = classesQuery.data ?? [];
  const classRuntimeElements = runtimeElements.filter(({ scopes }) => scopes.includes("class"));
  return <div className="flex flex-col gap-3"><p className="text-sm text-muted-foreground">This school-level run includes every registered admission enrolled in the session for the selected classes.</p><form.Subscribe selector={(state: any) => ({ values: state.values.classSelections, search: state.values.classSearch, page: state.values.classPage })}>{({ values, search, page }: any) => <form.Field name="classSelections">{(selectionField: any) => <form.Field name="classSearch">{(searchField: any) => <form.Field name="classPage">{(pageField: any) => <ClassScopePicker classes={classes} isPending={classesQuery.isPending} isError={classesQuery.isError} values={values} search={search} page={page} onValuesChange={selectionField.handleChange} onSearchChange={searchField.handleChange} onPageChange={pageField.handleChange} />}</form.Field>}</form.Field>}</form.Field>}</form.Subscribe>{classesQuery.isPending ? <p className="text-xs text-muted-foreground">Loading class billing values…</p> : classesQuery.isError ? null : <ClassRunValueFields form={form} classes={classes} runtimeElements={classRuntimeElements} currency={currency} amountPlaceholder={amountPlaceholder} />}</div>;
}

function BillingPreviewPanel({ preview, currency, values, previewPage, issuePage, refreshPreview }: { preview: BillingPreview; currency: string; values: BillingFormValue; previewPage: number; issuePage: number; refreshPreview: (value: BillingFormValue, page: number, issuePage: number) => Promise<void> }) {
  const previewCurrency = preview.currency ?? currency;
  return <div className="flex flex-col gap-4 overflow-x-auto rounded-xl border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-medium">Review {preview.period?.key ?? "billing run"}</h3><p className="text-xs text-muted-foreground">Configuration {preview.configurationHash.slice(0, 12)}… · {preview.counts.eligible} eligible · {preview.counts.skipped} skipped</p></div><p className="text-lg font-semibold">{formatMinor(preview.totalAmountMinor, previewCurrency)}</p></div>{preview.issues.items.length ? <section className="flex flex-col gap-2"><PreviewIssues issues={preview.issues.items} skippedCount={preview.counts.skipped} /><SimplePagination currentPage={preview.issues.pagination.currentPage} totalPages={preview.issues.pagination.totalPages} onPageChange={(page) => void refreshPreview(values, previewPage, page)} /></section> : null}<table className="w-full min-w-[640px] text-xs"><thead><tr className="border-b text-left"><th className="p-2">Admission</th><th className="p-2">Class</th><th className="p-2">Lines</th><th className="p-2 text-right">Total</th></tr></thead><tbody>{preview.breakdown.items.map((item) => <tr key={item.admissionId} className="border-b last:border-0"><td className="p-2 font-medium">{item.admissionName} · {item.admissionNumber}</td><td className="p-2">{item.classLabel}{item.sectionLabel ? ` · ${item.sectionLabel}` : ""}</td><td className="p-2">{item.lines.map((line) => line.feeElementName).join(", ")}</td><td className="p-2 text-right font-medium">{formatMinor(item.totalAmountMinor, previewCurrency)}</td></tr>)}</tbody></table><SimplePagination currentPage={preview.breakdown.pagination.currentPage} totalPages={preview.breakdown.pagination.totalPages} onPageChange={(page) => void refreshPreview(values, page, issuePage)} /></div>;
}

export function BillingRunDialog({ open, onOpenChange, schoolId, sessionId, currency, timeZone, runtimeElements }: { open: boolean; onOpenChange: (open: boolean) => void; schoolId: string; sessionId: string; currency: string; timeZone: string; runtimeElements: RuntimeElement[] }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [previewPage, setPreviewPage] = useState(1);
  const [issuePage, setIssuePage] = useState(1);
  const idempotency = useRef<IdempotencyDraftState>(undefined);
  const reviewedDraft = useRef<string | undefined>(undefined);
  const previewMutation = useMutation({ mutationFn: (input: any) => client.school.previewBillingRun(input) });
  const postMutation = useMutation({
    mutationFn: (input: any) => client.school.postBillingRun(input),
    onSuccess: async (run) => {
      await invalidateFinanceReadModels(queryClient, "billing_run");
      onOpenChange(false);
      router.push(`/school/${encodeURIComponent(schoolId)}/sessions/${encodeURIComponent(sessionId)}/billing/runs/${encodeURIComponent(run.id)}`);
    },
  });
  const schema = financeBillingDraftSchema.superRefine((value, context) => {
    const amounts = [
      ...Object.entries(value.runValues.session).map(([slug, amount]) => ({
        path: ["runValues", "session", slug],
        amount,
      })),
      ...Object.entries(value.runValues.classes).flatMap(
        ([classId, classValues]) =>
          Object.entries(classValues).map(([slug, amount]) => ({
            path: ["runValues", "classes", classId, slug],
            amount,
          })),
      ),
    ];
    for (const { path, amount } of amounts) {
      if (!amount.trim()) continue;
      const message = financeAmountError(amount, currency, false);
      if (message) context.addIssue({ code: "custom", path, message });
    }
  });
  const form = useForm({
    defaultValues: { billingDate: civilDateInTimeZone(timeZone), kind: "regular" as "regular" | "supplemental", supplementalReason: "", classSelections: [] as ScopeSelection[], classSearch: "", classPage: 1, runValues: { session: Object.fromEntries(runtimeElements.filter(({ scopes }) => !scopes.includes("class")).map(({ slug }) => [slug, ""])), classes: {} as Record<string, Record<string, string>> } },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      const parsed = schema.parse(value);
      const runValues = billingRunValues(parsed, currency);
      await previewMutation.mutateAsync({ schoolId, sessionId, billingDate: parsed.billingDate, classIds: financeScopeIds(parsed.classSelections), runValues, page: previewPage, limit: 20, issuePage, issueLimit: 50 });
      reviewedDraft.current = JSON.stringify(commandDraft(parsed));
    },
  });
  const preview = previewMutation.data;
  const exponent = currencyExponent(currency);
  const amountPlaceholder = exponent ? `0.${"0".repeat(exponent)}` : "0";

  async function refreshPreview(value: BillingFormValue, page: number, nextIssuePage: number) {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      form.setErrorMap({ onSubmit: { fields: Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join("."), issue.message])), form: undefined } });
      return;
    }
    setPreviewPage(page);
    setIssuePage(nextIssuePage);
    const runValues = billingRunValues(parsed.data, currency);
    await previewMutation.mutateAsync({ schoolId, sessionId, billingDate: parsed.data.billingDate, classIds: financeScopeIds(parsed.data.classSelections), runValues, page, limit: 20, issuePage: nextIssuePage, issueLimit: 50 });
    reviewedDraft.current = JSON.stringify(commandDraft(parsed.data));
  }

  async function postReviewedRun(value: BillingFormValue) {
    if (!preview) return;
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      form.setErrorMap({ onSubmit: { fields: Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join("."), issue.message])), form: undefined } });
      setConfirmOpen(false);
      return;
    }
    if (reviewedDraft.current !== JSON.stringify(commandDraft(parsed.data))) {
      form.setErrorMap({ onSubmit: { fields: {}, form: "The draft changed after preview. Refresh the preview before posting." } });
      return;
    }
    const runValues = billingRunValues(parsed.data, currency);
    const fingerprint = JSON.stringify({ schoolId, sessionId, ...commandDraft(parsed.data), runValues, configurationHash: preview.configurationHash });
    idempotency.current = idempotencyForDraft(idempotency.current, fingerprint, () => crypto.randomUUID());
    try {
      await postMutation.mutateAsync({ schoolId, sessionId, billingDate: parsed.data.billingDate, classIds: financeScopeIds(parsed.data.classSelections), runValues, kind: parsed.data.kind, supplementalReason: parsed.data.kind === "supplemental" ? parsed.data.supplementalReason.trim() : undefined, expectedConfigurationHash: preview.configurationHash, idempotencyKey: idempotency.current.key });
      setConfirmOpen(false);
    } catch (error) {
      setConfirmOpen(false);
      form.setErrorMap({ onSubmit: { fields: {}, form: error instanceof Error ? `${error.message} Your draft was retained; preview and confirm it again.` : "The reviewed preview is stale. Your draft was retained; preview again." } });
      idempotency.current = markIdempotencyAmbiguous(idempotency.current);
      await invalidateFinanceReadModels(queryClient, "billing_run");
      await refreshPreview(value, 1, 1).catch(() => undefined);
    }
  }

  function requestClose(dirty: boolean) {
    if (dirty) setDiscardOpen(true);
    else onOpenChange(false);
  }

  return <form.Subscribe selector={(state) => ({ dirty: state.isDirty, values: state.values })}>{({ dirty, values }) => (
    <>
      <DirtyGuard dirty={dirty} description="Your unposted billing command and preview will be lost." />
      <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) requestClose(dirty); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader><DialogTitle>Create billing run</DialogTitle><DialogDescription>Preview exact charges for an explicit period before posting anything.</DialogDescription></DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}>
            <BillingRunFields form={form} currency={currency} amountPlaceholder={amountPlaceholder} runtimeElements={runtimeElements} />
            <BillingScopeFields form={form} schoolId={schoolId} sessionId={sessionId} currency={currency} amountPlaceholder={amountPlaceholder} runtimeElements={runtimeElements} />
            {preview ? <BillingPreviewPanel preview={preview} currency={currency} values={values} previewPage={previewPage} issuePage={issuePage} refreshPreview={refreshPreview} /> : null}
            <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, errors: state.errors, isSubmitting: state.isSubmitting, values: state.values })}>{({ canSubmit, errors, isSubmitting, values: footerValues }) => <><FieldErrors errors={errors} />{previewMutation.isError ? <p className="text-xs text-destructive">{previewMutation.error.message}</p> : null}<DialogFooter><Button type="button" variant="outline" disabled={isSubmitting || postMutation.isPending} onClick={() => requestClose(dirty)}>Cancel</Button><Button type="submit" variant="secondary" disabled={!canSubmit || isSubmitting}>{isSubmitting ? "Previewing…" : preview ? "Refresh preview" : "Preview run"}</Button><Button type="button" disabled={!preview?.readyToPost || reviewedDraft.current !== commandDraftFingerprint(footerValues) || isSubmitting || postMutation.isPending} onClick={() => setConfirmOpen(true)}>Post billing run</Button></DialogFooter></>}</form.Subscribe>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Post this billing run?</AlertDialogTitle><AlertDialogDescription>This creates immutable bills for {preview?.counts.eligible ?? 0} admissions totaling {preview ? formatMinor(preview.totalAmountMinor, preview.currency ?? currency) : "—"}. A later correction must be recorded as a reversal.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={postMutation.isPending}>Keep reviewing</AlertDialogCancel><AlertDialogAction disabled={postMutation.isPending} onClick={(event) => { event.preventDefault(); void postReviewedRun(values); }}>{postMutation.isPending ? "Posting…" : "Post bills"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Discard billing draft?</AlertDialogTitle><AlertDialogDescription>Your unposted billing command and preview will be lost.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => onOpenChange(false)}>Discard draft</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </>
  )}</form.Subscribe>;
}
