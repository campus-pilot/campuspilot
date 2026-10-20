"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown } from "lucide-react";
import { z } from "zod";
import { billingRunPreviewOutputSchema } from "@campuspilot/api/routers/school/billing/billing.dto";
import { civilDateInTimeZone, currencyExponent, financeAmountError, financeBillingDraftSchema, financeScopeIds, formatMinor, decimalToMinor, groupFinanceIssues, idempotencyForDraft, markIdempotencyAmbiguous, type FinanceScopeSelection, type IdempotencyDraftState } from "@campuspilot/components/finance";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@campuspilot/ui/components/alert-dialog";
import { Badge } from "@campuspilot/ui/components/badge";
import { Button } from "@campuspilot/ui/components/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@campuspilot/ui/components/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@campuspilot/ui/components/dialog";
import { Input } from "@campuspilot/ui/components/input";
import { Label } from "@campuspilot/ui/components/label";
import { Popover, PopoverContent, PopoverTrigger } from "@campuspilot/ui/components/popover";
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
type PreviewAdmission = BillingPreview["breakdown"]["items"][number];
type PreviewLine = PreviewAdmission["lines"][number];

const previewSearchSchema = z.object({
  query: z.string().max(200, "Search cannot exceed 200 characters."),
  appliedQuery: z.string().max(200),
});

const billingRunSetupSchema = z
  .object({
    billingDate: z.string().date("Choose a billing date."),
    kind: z.enum(["regular", "supplemental"]),
    supplementalReason: z.string(),
  })
  .superRefine((value, context) => {
    if (value.kind === "supplemental" && !value.supplementalReason.trim()) {
      context.addIssue({
        code: "custom",
        path: ["supplementalReason"],
        message: "Explain why this supplemental charge is required.",
      });
    }
  });

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
  const classes: Record<string, Record<string, string>> = Object.fromEntries(
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

  const summary = isPending
    ? "Loading classes…"
    : values.length
      ? `${selectedClasses.length} of ${classes.length} classes`
      : `All ${classes.length} classes`;

  return <div className="flex flex-col gap-1.5"><Label>Classes</Label><Popover><PopoverTrigger asChild><Button type="button" variant="outline" role="combobox" className="w-full justify-between" disabled={isPending || isError}><span className="truncate">{summary}</span><ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden /></Button></PopoverTrigger><PopoverContent align="start" className="w-80 p-0"><Command shouldFilter={false}><CommandInput value={search} placeholder="Search classes…" onValueChange={(value) => { onSearchChange(value); onPageChange(1); }} /><CommandList><CommandEmpty>No classes match this search.</CommandEmpty><CommandGroup heading="Classes in this session">{visible.map((item) => <CommandItem key={item.id} value={item.label} onSelect={() => toggleClass(item)}><Check className={selected.has(item.id) ? "size-4 opacity-100" : "size-4 opacity-0"} aria-hidden /><span className="truncate">{item.label}</span></CommandItem>)}</CommandGroup></CommandList><div className="flex flex-col gap-2 border-t p-2">{values.length ? <Button type="button" size="xs" variant="outline" onClick={() => onValuesChange([])}>Select all classes</Button> : <p className="text-center text-xs text-muted-foreground">All classes are selected</p>}<SimplePagination currentPage={page} totalPages={totalPages} onPageChange={onPageChange} /></div></Command></PopoverContent></Popover>{isError ? <p className="text-xs text-destructive">Unable to load classes.</p> : <p className="text-xs text-muted-foreground">All classes are selected by default. Open this list only to exclude or restore classes.</p>}</div>;
}

function PreviewIssues({ issues, skippedCount }: { issues: PreviewIssue[]; skippedCount: number }) {
  const scopes = groupFinanceIssues(issues);
  const skipped = issues.filter((issue) => issue.scope === "admission" && issue.blocking);
  return <div className="flex flex-col gap-3"><h4 className="text-sm font-medium">Readiness issues</h4>{scopes.map(({ scope, items }) => <section key={scope} className="flex flex-col gap-1"><h5 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{scope}</h5>{items.map((issue, index) => <div key={`${issue.code}-${issue.entityId}-${index}`} className="flex items-start gap-2 rounded-lg bg-muted/50 p-2"><Badge variant={issue.blocking ? "destructive" : "outline"}>{issue.blocking ? "Blocking" : "Notice"}</Badge><div><p>{issue.entityLabel}</p><p className="text-xs text-muted-foreground">{issue.message}</p></div></div>)}</section>)}{skippedCount ? <div className="overflow-x-auto"><p className="mb-2 text-sm font-medium">Skipped records ({skippedCount})</p><table className="w-full min-w-[480px] text-xs"><thead><tr className="border-b text-left"><th className="p-2">Admission</th><th className="p-2">Reason</th></tr></thead><tbody>{skipped.map((issue, index) => <tr key={`${issue.entityId}-${index}`} className="border-b last:border-0"><td className="p-2 font-medium">{issue.entityLabel}</td><td className="p-2">{issue.message}</td></tr>)}</tbody></table>{skipped.length < skippedCount ? <p className="p-2 text-xs text-muted-foreground">This page shows {skipped.length} of {skippedCount} skipped records. Use issue pagination for the remaining records.</p> : null}</div> : null}</div>;
}

function BillingRunSetupFields({ form }: { form: any }) {
  return <><div className="grid gap-3 sm:grid-cols-2"><form.Field name="billingDate">{(field: any) => <div className="flex flex-col gap-1.5"><Label htmlFor="billing-date">Date</Label><Input id="billing-date" type="date" value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} /><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field><form.Field name="kind">{(field: any) => <div className="flex flex-col gap-1.5"><Label htmlFor="billing-kind">Type</Label><Select value={field.state.value} onValueChange={(value) => field.handleChange(value as "regular" | "supplemental")}><SelectTrigger id="billing-kind" className="w-full"><SelectValue>{field.state.value === "regular" ? "Regular" : "Supplemental"}</SelectValue></SelectTrigger><SelectContent className="max-w-sm"><SelectItem value="regular" textValue="Regular" className="items-start py-2 pr-8"><span className="flex flex-col items-start gap-0.5"><span className="font-medium">Regular</span><span className="whitespace-normal text-left text-[11px] text-muted-foreground">The normal recurring charges for this period. Only one regular run can be created per period.</span></span></SelectItem><SelectItem value="supplemental" textValue="Supplemental" className="items-start py-2 pr-8"><span className="flex flex-col items-start gap-0.5"><span className="font-medium">Supplemental</span><span className="whitespace-normal text-left text-[11px] text-muted-foreground">Additional approved charges in a period that already has, or will have, its regular run. A reason is required.</span></span></SelectItem></SelectContent></Select><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field></div><form.Subscribe selector={(state: any) => state.values.kind}>{(kind: string) => kind === "supplemental" ? <form.Field name="supplementalReason">{(field: any) => <div className="flex flex-col gap-1.5"><Label htmlFor="supplemental-reason">Reason</Label><Textarea id="supplemental-reason" value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} /><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field> : null}</form.Subscribe></>;
}

function ClassRunValueFields({ form, classes, runtimeElements, currency, amountPlaceholder }: { form: any; classes: BillingClass[]; runtimeElements: RuntimeElement[]; currency: string; amountPlaceholder: string }) {
  if (!runtimeElements.length) return null;
  return <form.Subscribe selector={(state: any) => state.values.classSelections}>{(classSelections: ScopeSelection[]) => {
    const selectedClasses = selectedBillingClasses(classes, classSelections);
    return <fieldset className="flex flex-col gap-3 rounded-xl border p-3"><legend className="px-1 text-sm font-medium">Values by class · Optional</legend><p className="text-xs text-muted-foreground">Enter a value only for classes that should receive this charge. Blank cells are omitted from this billing run; zero is an explicit value.</p><div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><thead><tr className="border-b text-left"><th className="p-2">Class</th>{runtimeElements.map((element) => <th key={element.slug} className="p-2">{element.name} ({currency})</th>)}</tr></thead><tbody>{selectedClasses.map((schoolClass) => <tr key={schoolClass.id} className="border-b last:border-0"><th scope="row" className="p-2 text-left font-medium">{schoolClass.label}</th>{runtimeElements.map((element) => <td key={element.slug} className="p-2"><form.Field name={`runValues.classes.${schoolClass.id}.${element.slug}`}>{(field: any) => <div className="flex min-w-36 flex-col gap-1"><Input aria-label={`${element.name} for ${schoolClass.label}`} inputMode="decimal" placeholder={amountPlaceholder} value={String(field.state.value ?? "")} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} /><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field></td>)}</tr>)}</tbody></table></div></fieldset>;
  }}</form.Subscribe>;
}

function BillingClassScopeField({ form, schoolId, sessionId }: { form: any; schoolId: string; sessionId: string }) {
  const classesQuery = useQuery(orpc.school.listClasses.queryOptions({ input: { schoolId, sessionId } }));
  const classes = classesQuery.data ?? [];
  return <div className="flex flex-col gap-3"><p className="text-sm text-muted-foreground">This school-level run includes every active, registered admission enrolled in the session for the selected classes.</p><form.Subscribe selector={(state: any) => ({ values: state.values.classSelections, search: state.values.classSearch, page: state.values.classPage })}>{({ values, search, page }: any) => <form.Field name="classSelections">{(selectionField: any) => <form.Field name="classSearch">{(searchField: any) => <form.Field name="classPage">{(pageField: any) => <ClassScopePicker classes={classes} isPending={classesQuery.isPending} isError={classesQuery.isError} values={values} search={search} page={page} onValuesChange={selectionField.handleChange} onSearchChange={searchField.handleChange} onPageChange={pageField.handleChange} />}</form.Field>}</form.Field>}</form.Field>}</form.Subscribe></div>;
}

function OptionalBillingRunValues({ form, schoolId, sessionId, currency, amountPlaceholder, runtimeElements }: { form: any; schoolId: string; sessionId: string; currency: string; amountPlaceholder: string; runtimeElements: RuntimeElement[] }) {
  const classesQuery = useQuery(orpc.school.listClasses.queryOptions({ input: { schoolId, sessionId } }));
  const classes = classesQuery.data ?? [];
  const sessionElements = runtimeElements.filter(({ scopes }) => !scopes.includes("class"));
  const classElements = runtimeElements.filter(({ scopes }) => scopes.includes("class"));
  if (!runtimeElements.length) return <div className="rounded-xl border border-dashed p-4"><p className="text-sm font-medium">No optional run values</p><p className="text-xs text-muted-foreground">This run will use only the ordinary prices already configured for the session, classes, and admissions.</p></div>;
  return <div className="flex flex-col gap-3"><div><h3 className="text-sm font-medium">Optional bill-generation values</h3><p className="text-xs text-muted-foreground">Leave every value blank unless this run should add that charge. Entered values become part of immutable bill lines when the run is created.</p></div>{sessionElements.length ? <fieldset className="grid gap-3 rounded-xl border p-3 sm:grid-cols-2"><legend className="px-1 text-sm font-medium">School-wide values · Optional</legend>{sessionElements.map((element) => <form.Field key={element.slug} name={`runValues.session.${element.slug}`}>{(field: any) => <div className="flex flex-col gap-1.5"><Label htmlFor={`run-session-${element.slug}`}>{element.name} ({currency})</Label><Input id={`run-session-${element.slug}`} inputMode="decimal" placeholder={amountPlaceholder} value={String(field.state.value ?? "")} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} /><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field>)}</fieldset> : null}{classesQuery.isPending ? <p className="text-xs text-muted-foreground">Loading class value rows…</p> : classesQuery.isError ? <p className="text-xs text-destructive">Unable to load class value rows.</p> : <ClassRunValueFields form={form} classes={classes} runtimeElements={classElements} currency={currency} amountPlaceholder={amountPlaceholder} />}</div>;
}

function BillingPreviewCharges({ lines, currency }: { lines: PreviewLine[]; currency: string }) {
  return <ul className="flex min-w-48 flex-col gap-1">{lines.map((line) => <li key={line.feeElementSlug} className="flex items-baseline justify-between gap-3"><span>{line.feeElementName}</span><span className="whitespace-nowrap text-muted-foreground">{formatMinor(line.amountMinor, currency)}</span></li>)}</ul>;
}

function BillingPreviewRow({ item, currency }: { item: PreviewAdmission; currency: string }) {
  return <tr className="border-b align-top last:border-0"><td className="p-2"><p className="font-medium">{item.admissionName}</p><p className="text-xs text-muted-foreground">{item.admissionNumber}</p></td><td className="p-2">{item.classLabel}{item.sectionLabel ? ` / ${item.sectionLabel}` : ""}</td><td className="p-2"><BillingPreviewCharges lines={item.lines} currency={currency} /></td><td className="p-2 text-right font-medium">{formatMinor(item.totalAmountMinor, currency)}</td></tr>;
}

function BillingPreviewTable({ items, currency }: { items: PreviewAdmission[]; currency: string }) {
  return <div className="overflow-x-auto overflow-y-hidden rounded-xl border"><table className="w-full min-w-[640px] text-sm"><thead className="bg-muted/50"><tr className="border-b text-left"><th className="p-2 font-medium">Name</th><th className="p-2 font-medium">Class</th><th className="p-2 font-medium">Charges</th><th className="p-2 text-right font-medium">Total</th></tr></thead><tbody>{items.length ? items.map((item) => <BillingPreviewRow key={item.admissionId} item={item} currency={currency} />) : <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">No student bills match this search.</td></tr>}</tbody></table></div>;
}

function BillingPreviewSearchControls({ form, isPending, onClear }: { form: any; isPending: boolean; onClear: () => void }) {
  return <form.Field name="query">{(field: any) => <div className="flex flex-col gap-1.5" role="search"><Label htmlFor="billing-preview-search">Search student bills</Label><div className="flex flex-wrap gap-2"><Input id="billing-preview-search" className="min-w-56 flex-1" disabled={isPending} maxLength={200} placeholder="Search name or admission number…" value={field.state.value} onBlur={field.handleBlur} onChange={(event) => field.handleChange(event.target.value)} onKeyDown={(event) => { if (event.key !== "Enter") return; event.preventDefault(); event.stopPropagation(); if (!isPending) void form.handleSubmit().catch(() => undefined); }} /><Button type="button" variant="secondary" disabled={isPending} onClick={() => void form.handleSubmit().catch(() => undefined)}>{isPending ? "Searching…" : "Search"}</Button>{field.state.value ? <Button type="button" variant="outline" disabled={isPending} onClick={onClear}>Clear</Button> : null}</div><FieldErrors errors={field.state.meta.errors} /></div>}</form.Field>;
}

function BillingPreviewBrowser({ preview, currency, issuePage, isPending, searchForm, onClear, onRefresh }: { preview: BillingPreview; currency: string; issuePage: number; isPending: boolean; searchForm: any; onClear: () => void; onRefresh: (page: number, issuePage: number, searchQuery: string) => Promise<void> }) {
  const previewCurrency = preview.currency ?? currency;
  return <div className="flex flex-col gap-3"><BillingPreviewSearchControls form={searchForm} isPending={isPending} onClear={onClear} /><BillingPreviewTable items={preview.breakdown.items} currency={previewCurrency} /><searchForm.Subscribe selector={(state: any) => state.values.appliedQuery}>{(appliedQuery: string) => <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">{preview.breakdown.pagination.totalItems} matching student bill{preview.breakdown.pagination.totalItems === 1 ? "" : "s"}</p><SimplePagination currentPage={preview.breakdown.pagination.currentPage} totalPages={preview.breakdown.pagination.totalPages} disabled={isPending} onPageChange={(page) => { if (!isPending) void onRefresh(page, issuePage, appliedQuery).catch(() => undefined); }} /></div>}</searchForm.Subscribe></div>;
}

function BillingPreviewSummary({ preview, currency }: { preview: BillingPreview; currency: string }) {
  return <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-medium">Review billing run</h3><p className="text-xs text-muted-foreground">{preview.counts.eligible} bills ready · {preview.counts.skipped} need attention</p></div><div className="text-right"><p className="text-xs text-muted-foreground">Billing total</p><p className="text-lg font-semibold">{formatMinor(preview.totalAmountMinor, preview.currency ?? currency)}</p></div></div>;
}

function BillingPreviewPanel({ preview, currency, values, previewPage, issuePage, previewVisible, isPending, onShowPreview, refreshPreview }: { preview: BillingPreview; currency: string; values: BillingFormValue; previewPage: number; issuePage: number; previewVisible: boolean; isPending: boolean; onShowPreview: () => void; refreshPreview: (value: BillingFormValue, page: number, issuePage: number, searchQuery?: string) => Promise<void> }) {
  const searchForm = useForm({
    defaultValues: { query: "", appliedQuery: "" },
    validators: { onChange: previewSearchSchema },
    onSubmit: async ({ value }) => {
      const query = value.query.trim();
      await refreshPreview(values, 1, issuePage, query);
      searchForm.setFieldValue("appliedQuery", query);
    },
  });

  async function clearSearch() {
    searchForm.setFieldValue("query", "");
    try {
      await refreshPreview(values, 1, issuePage, "");
      searchForm.setFieldValue("appliedQuery", "");
    } catch {
      // The previous successful table remains visible and a blank Search can retry.
    }
  }

  return <searchForm.Subscribe selector={(state) => state.values.appliedQuery}>{(appliedQuery) => <div className="flex flex-col gap-4"><BillingPreviewSummary preview={preview} currency={currency} />{preview.issues.items.length ? <section className="flex flex-col gap-2"><PreviewIssues issues={preview.issues.items} skippedCount={preview.counts.skipped} /><SimplePagination currentPage={preview.issues.pagination.currentPage} totalPages={preview.issues.pagination.totalPages} disabled={isPending} onPageChange={(page) => { if (!isPending) void refreshPreview(values, previewPage, page, appliedQuery).catch(() => undefined); }} /></section> : null}{previewVisible ? <BillingPreviewBrowser preview={preview} currency={currency} issuePage={issuePage} isPending={isPending} searchForm={searchForm} onClear={() => void clearSearch()} onRefresh={(page, nextIssuePage, searchQuery) => refreshPreview(values, page, nextIssuePage, searchQuery)} /> : <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-center"><div><p className="text-sm font-medium">Student bill preview</p><p className="text-xs text-muted-foreground">Optionally inspect up to five student bills at a time before creating the run.</p></div><Button type="button" variant="outline" onClick={onShowPreview}>Show preview</Button></div>}</div>}</searchForm.Subscribe>;
}

export function BillingRunDialog({ open, onOpenChange, schoolId, sessionId, currency, timeZone, runtimeElements }: { open: boolean; onOpenChange: (open: boolean) => void; schoolId: string; sessionId: string; currency: string; timeZone: string; runtimeElements: RuntimeElement[] }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [step, setStep] = useState<"setup" | "values" | "review">("setup");
  const [discardOpen, setDiscardOpen] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewSearchVersion, setPreviewSearchVersion] = useState(0);
  const [previewPage, setPreviewPage] = useState(1);
  const [issuePage, setIssuePage] = useState(1);
  const idempotency = useRef<IdempotencyDraftState>(undefined);
  const reviewedDraft = useRef<string | undefined>(undefined);
  const lastSuccessfulPreview = useRef<BillingPreview | undefined>(undefined);
  const previewMutation = useMutation({ mutationFn: (input: any) => client.school.previewBillingRun(input) });
  const postMutation = useMutation({
    mutationFn: (input: any) => client.school.postBillingRun(input),
    onSuccess: async (run) => {
      await invalidateFinanceReadModels(queryClient, "billing_run");
      onOpenChange(false);
      router.push(`/school/${encodeURIComponent(schoolId)}/sessions/${encodeURIComponent(sessionId)}/billing/runs/${encodeURIComponent(run.id)}`);
    },
  });
  const schema = formSchema.superRefine((value, context) => {
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
      setPreviewPage(1);
      setIssuePage(1);
      setPreviewVisible(false);
      await requestPreview({ schoolId, sessionId, billingDate: parsed.billingDate, classIds: financeScopeIds(parsed.classSelections), runValues, searchQuery: "", page: 1, limit: 5, issuePage: 1, issueLimit: 50 });
      reviewedDraft.current = JSON.stringify(commandDraft(parsed));
      setStep("review");
    },
  });
  const preview = previewMutation.data ?? lastSuccessfulPreview.current;
  const exponent = currencyExponent(currency);
  const amountPlaceholder = exponent ? `0.${"0".repeat(exponent)}` : "0";

  /** Retains the last successful review while a presentation-only refresh is pending or fails. */
  async function requestPreview(input: Parameters<typeof client.school.previewBillingRun>[0]) {
    const nextPreview = await previewMutation.mutateAsync(input);
    lastSuccessfulPreview.current = nextPreview;
    return nextPreview;
  }

  async function refreshPreview(value: BillingFormValue, page: number, nextIssuePage: number, searchQuery = "") {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      form.setErrorMap({ onSubmit: { fields: Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join("."), issue.message])), form: undefined } });
      return;
    }
    setPreviewPage(page);
    setIssuePage(nextIssuePage);
    const runValues = billingRunValues(parsed.data, currency);
    await requestPreview({ schoolId, sessionId, billingDate: parsed.data.billingDate, classIds: financeScopeIds(parsed.data.classSelections), runValues, searchQuery: searchQuery.trim(), page, limit: 5, issuePage: nextIssuePage, issueLimit: 50 });
    reviewedDraft.current = JSON.stringify(commandDraft(parsed.data));
  }

  async function postReviewedRun(value: BillingFormValue) {
    if (!preview) return;
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      form.setErrorMap({ onSubmit: { fields: Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join("."), issue.message])), form: undefined } });
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
    } catch (error) {
      form.setErrorMap({ onSubmit: { fields: {}, form: error instanceof Error ? `${error.message} Your draft was retained; review it and create again.` : "The reviewed preview is stale. Your draft was retained; review it again." } });
      idempotency.current = markIdempotencyAmbiguous(idempotency.current);
      setPreviewVisible(false);
      setPreviewSearchVersion((version) => version + 1);
      await invalidateFinanceReadModels(queryClient, "billing_run");
      await refreshPreview(value, 1, 1).catch(() => undefined);
    }
  }

  function requestClose(dirty: boolean) {
    if (dirty) setDiscardOpen(true);
    else onOpenChange(false);
  }

  function showOptionalValues(value: BillingFormValue) {
    const parsed = billingRunSetupSchema.safeParse(value);
    if (!parsed.success) {
      form.setErrorMap({
        onSubmit: {
          fields: Object.fromEntries(
            parsed.error.issues.map((issue) => [
              issue.path.join("."),
              issue.message,
            ]),
          ),
          form: undefined,
        },
      });
      return;
    }
    form.setErrorMap({ onSubmit: { fields: {}, form: undefined } });
    setStep("values");
  }

  return <form.Subscribe selector={(state) => ({ dirty: state.isDirty, values: state.values })}>{({ dirty, values }) => (
    <>
      <DirtyGuard dirty={dirty} description="Your unposted billing command and preview will be lost." />
      <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) requestClose(dirty); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader><DialogTitle>Create billing run</DialogTitle><DialogDescription>Choose the run scope, add any optional charges, then review the totals and optionally inspect individual bills before posting.</DialogDescription></DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); if (step === "setup") showOptionalValues(values); else if (step === "values") void form.handleSubmit(); }}>
            {step === "setup" ? <><BillingRunSetupFields form={form} /><BillingClassScopeField form={form} schoolId={schoolId} sessionId={sessionId} /></> : null}
            {step === "values" ? <OptionalBillingRunValues form={form} schoolId={schoolId} sessionId={sessionId} currency={currency} amountPlaceholder={amountPlaceholder} runtimeElements={runtimeElements} /> : null}
            {step === "review" && preview ? <BillingPreviewPanel key={previewSearchVersion} preview={preview} currency={currency} values={values} previewPage={previewPage} issuePage={issuePage} previewVisible={previewVisible} isPending={previewMutation.isPending} onShowPreview={() => setPreviewVisible(true)} refreshPreview={refreshPreview} /> : null}
            <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, errors: state.errors, isSubmitting: state.isSubmitting, values: state.values })}>{({ canSubmit, errors, isSubmitting, values: footerValues }) => <><FieldErrors errors={errors} />{previewMutation.isError ? <p className="text-xs text-destructive">{previewMutation.error.message}</p> : null}<DialogFooter>{step === "setup" ? <Button type="submit">Continue</Button> : null}{step === "values" ? <><Button type="button" variant="outline" disabled={isSubmitting || postMutation.isPending} onClick={() => setStep("setup")}>Back</Button><Button type="submit" disabled={!canSubmit || isSubmitting}>{isSubmitting ? "Preparing review…" : "Next"}</Button></> : null}{step === "review" ? <><Button type="button" variant="outline" disabled={isSubmitting || previewMutation.isPending || postMutation.isPending} onClick={() => setStep("values")}>Back</Button><Button type="button" disabled={!preview?.readyToPost || reviewedDraft.current !== commandDraftFingerprint(footerValues) || isSubmitting || previewMutation.isPending || postMutation.isPending} onClick={() => void postReviewedRun(footerValues)}>{postMutation.isPending ? "Creating…" : "Create"}</Button></> : null}</DialogFooter></>}</form.Subscribe>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Discard billing draft?</AlertDialogTitle><AlertDialogDescription>Your unposted billing command and preview will be lost.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => onOpenChange(false)}>Discard draft</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </>
  )}</form.Subscribe>;
}
