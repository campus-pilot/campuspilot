"use client";

import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import { useId } from "react";
import { z } from "zod";
import {
  MAX_DOCUMENT_SOURCE_ITEMS,
  type DocumentGenerationJobDto,
  type DocumentSource,
} from "@campuspilot/api/routers/school/document/document.dto";
import {
  DocumentErrors,
  DocumentNotice,
  DocumentSelect,
} from "@campuspilot/components/documents/document-controls";
import {
  getStatementDateBounds,
  isReadyStatementSession,
  type StatementReadySession,
  type StatementSession,
} from "@campuspilot/components/documents/statement-session";
import { Alert, AlertDescription, AlertTitle } from "@campuspilot/ui/components/alert";
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
import { RequirePermissions } from "@/components/require-permissions";
import { useSchoolSessions } from "@/components/session-selection";
import { client, orpc } from "@/lib/orpc";
import {
  DocumentLoading,
  DocumentReadError,
  SCHOOL_ACTIONS,
  documentPermission,
  type DocumentScope,
} from "./document-common";
import { DocumentDownload, SchoolClassSelect } from "./document-generator";
import { DocumentJobTracker } from "./document-job";
import { FinancePreviewPanel } from "./finance-preview-panel";
import { StudentPicker } from "./student-recipient-picker";

/**
 * Bill due (docs/document-system.md "Bill due"): a bill for each student as
 * of a chosen date, printed with the school's bill template. Generation is
 * bound to the reviewed ledger like a statement's: creating always previews
 * first and sends the preview's review hash, so a payment posted in between
 * is never printed silently (the server refuses the stale hash instead).
 */
type BillDueSource = Extract<DocumentSource, { documentType: "bill_due" }>;
type RecipientKind = BillDueSource["recipients"]["kind"];

const recipientOptions = [
  { value: "session", label: "Whole session" },
  { value: "class", label: "One class" },
  { value: "admissions", label: "Chosen students" },
] as const satisfies readonly { value: RecipientKind; label: string }[];

/**
 * The session's finance readiness for a Bill due, as an explicit state: the
 * server needs the session's currency, time zone, billing cycle and cadence
 * (`readyForBilling`), and the dates offered follow the session's years and
 * cycle start month. Nothing is inferred from a partly filled configuration.
 */
export function useFinanceSession(schoolId: string, sessionId: string): StatementSession | undefined {
  const sessions = useSchoolSessions(schoolId);
  const finance = useQuery(orpc.school.getSessionFinance.queryOptions({ input: { schoolId, sessionId } }));
  const session = sessions.data?.find((item) => item.id === sessionId);
  if (sessions.isPending) return { id: sessionId, label: "", status: "checking" };
  if (!session) return undefined;
  const label = `${session.sessionStartYear}–${session.sessionEndYear}`;
  if (finance.isPending) return { id: sessionId, label, status: "checking" };
  if (finance.isError)
    return { id: sessionId, label, status: "error", error: finance.error, retrying: finance.isFetching, retry: () => finance.refetch() };
  const config = finance.data.financeConfig;
  if (!finance.data.configurationReadiness.readyForBilling || !config?.currency || !config.timeZone || !config.cycleStartMonth)
    return { id: sessionId, label, status: "incomplete", missingFields: finance.data.configurationReadiness.missingFields };
  return {
    id: sessionId,
    label,
    status: "ready",
    currency: config.currency,
    timeZone: config.timeZone,
    cycleStartMonth: config.cycleStartMonth,
    startYear: session.sessionStartYear,
    endYear: session.sessionEndYear,
  };
}

/** Why a Bill due cannot be created for the session yet, or null when it can. */
function SessionRequirement({ session }: { session: StatementSession | undefined }) {
  if (!session) return <DocumentNotice>This session could not be found.</DocumentNotice>;
  if (session.status === "checking")
    return (
      <Alert>
        <LoaderCircle className="animate-spin" aria-hidden />
        <AlertTitle>Checking finance settings</AlertTitle>
        <AlertDescription>Bills due are available once this session&apos;s finance setup is checked.</AlertDescription>
      </Alert>
    );
  if (session.status === "error")
    return (
      <Alert variant="destructive">
        <CircleAlert aria-hidden />
        <AlertTitle>Finance settings could not be loaded</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-2">
          {session.error instanceof Error ? session.error.message : "Try loading them again."}
          <Button type="button" size="sm" variant="outline" disabled={session.retrying} onClick={() => void session.retry()}>
            <RefreshCw className={session.retrying ? "animate-spin" : undefined} aria-hidden />
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  if (session.status === "incomplete")
    return (
      <Alert>
        <CircleAlert aria-hidden />
        <AlertTitle>Complete this session&apos;s finance setup</AlertTitle>
        <AlertDescription>
          Add the {session.missingFields.length ? session.missingFields.join(", ") : "missing finance settings"} in the session&apos;s finance settings before creating bills due.
        </AlertDescription>
      </Alert>
    );
  return null;
}

/** The date choice: today by default, never after today, inside the session (`getStatementDateBounds`). */
function BillDateField({
  field,
  session,
  onChange,
}: {
  field: { name: string; state: { value: string; meta: { errors: readonly unknown[] } }; handleChange: (value: string) => void; handleBlur: () => void };
  session: StatementReadySession;
  onChange?: () => void;
}) {
  const id = useId();
  const bounds = getStatementDateBounds(session);
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>Bill date</Label>
      <Input
        id={id}
        name={field.name}
        type="date"
        min={bounds.minDate}
        max={bounds.maxDate}
        disabled={!bounds.hasValidDate}
        value={field.state.value}
        aria-invalid={field.state.meta.errors.length > 0}
        aria-describedby={`${id}-help`}
        onBlur={field.handleBlur}
        onChange={(event) => {
          field.handleChange(event.target.value);
          onChange?.();
        }}
      />
      <div id={`${id}-help`} className="flex flex-col gap-1">
        <p className="text-xs text-muted-foreground">
          {bounds.hasValidDate
            ? "Everything billed in the billing period that contains this date, every payment and credit up to the end of this date, and the amount due."
            : `Bills due become available on ${bounds.minDate}.`}
        </p>
        <DocumentErrors errors={field.state.meta.errors} />
      </div>
    </div>
  );
}

/** The date rule as a Zod check: a real date within the session, not after today. */
function billDateSchema(session: StatementReadySession) {
  const bounds = getStatementDateBounds(session);
  return z
    .string()
    .date("Choose a valid date.")
    .refine((value) => bounds.hasValidDate && value >= bounds.minDate && value <= bounds.maxDate, {
      message: `Choose a date from ${bounds.minDate} through ${bounds.maxDate}.`,
    });
}

const previewSchema = z
  .object({
    html: z.string(),
    warnings: z.array(z.string()),
    recipientCount: z.number().int().nonnegative(),
    sampleCount: z.number().int().nonnegative(),
    reviewHash: z.string(),
    fingerprint: z.string(),
  })
  .nullable();
type BillDuePreview = z.infer<typeof previewSchema>;

/** Previews a Bill due source; the preview carries the review hash generation must present. */
async function previewBillDue(schoolId: string, source: BillDueSource, templateRevisionId: string, fingerprint: string): Promise<NonNullable<BillDuePreview>> {
  const preview = await client.school.previewDocument({ schoolId, source, templateRevisionId });
  if (!preview.reviewHash) throw new Error("The bill preview did not return a review hash.");
  return {
    html: preview.html,
    warnings: preview.warnings,
    recipientCount: preview.documentCount,
    sampleCount: preview.sampleCount,
    reviewHash: preview.reviewHash,
    fingerprint,
  };
}

/**
 * The Bills creator's **By date** tab: the date, who it is for (the whole
 * session, one class, or chosen students of a class), then the shared
 * preview and create panel with the job's progress.
 */
export function BillDueGenerator({ scope, templateId, onHistory }: { scope: DocumentScope; templateId: string; onHistory: () => void }) {
  return (
    <RequirePermissions
      permissions={documentPermission(scope.schoolId, SCHOOL_ACTIONS.READ_SESSION)}
      fallback={<DocumentNotice>You do not have access to this session.</DocumentNotice>}
    >
      <BillDueSessionGate scope={scope} templateId={templateId} onHistory={onHistory} />
    </RequirePermissions>
  );
}

function BillDueSessionGate({ scope, templateId, onHistory }: { scope: DocumentScope; templateId: string; onHistory: () => void }) {
  const session = useFinanceSession(scope.schoolId, scope.sessionId);
  if (!isReadyStatementSession(session)) return <SessionRequirement session={session} />;
  // A change to the session's finance facts starts the form afresh (a keyed lifecycle, no effect).
  const key = `${session.id}:${session.timeZone}:${session.cycleStartMonth}:${session.startYear}`;
  return <BillDueForm key={key} scope={scope} session={session} templateId={templateId} onHistory={onHistory} />;
}

/** The By date form and its calls; kept apart from the markup (`BillDueForm`). */
function useBillDueForm(scope: DocumentScope, session: StatementReadySession, templateId: string) {
  const form = useForm({
    defaultValues: {
      throughDate: getStatementDateBounds(session).defaultDate,
      recipientKind: "session" as RecipientKind,
      classId: "",
      admissionIds: [] as string[],
      mode: "preview" as "preview" | "generate",
      preview: null as BillDuePreview,
      generated: null as { job: DocumentGenerationJobDto; fingerprint: string } | null,
      error: "",
    },
    validators: {
      onChange: z
        .object({
          throughDate: billDateSchema(session),
          recipientKind: z.enum(["session", "class", "admissions"]),
          classId: z.string(),
          admissionIds: z.array(z.string()).max(MAX_DOCUMENT_SOURCE_ITEMS),
          mode: z.enum(["preview", "generate"]),
          preview: previewSchema,
          generated: z.object({ job: z.custom<DocumentGenerationJobDto>(), fingerprint: z.string() }).nullable(),
          error: z.string(),
        })
        .superRefine((values, context) => {
          if (values.recipientKind !== "session" && !values.classId)
            context.addIssue({ code: "custom", path: ["classId"], message: "Choose a class." });
          if (values.recipientKind === "admissions" && values.admissionIds.length === 0)
            context.addIssue({ code: "custom", path: ["admissionIds"], message: "Choose at least one student." });
        }),
    },
    onSubmit: async ({ value }) => {
      const source = sourceOf(value);
      if (!source) return;
      const fingerprint = JSON.stringify({ source, templateId });
      form.setFieldValue("error", "");
      form.setFieldValue("generated", null);
      try {
        // Creating previews again, so the PDF is bound to the ledger as it is now.
        const preview = await previewBillDue(scope.schoolId, source, templateId, fingerprint);
        form.setFieldValue("preview", preview);
        if (value.mode === "preview") return;
        const generated = await client.school.generateDocument({
          schoolId: scope.schoolId,
          source: { ...source, expectedReviewHash: preview.reviewHash },
          templateRevisionId: templateId,
        });
        form.setFieldValue("generated", { job: generated.job, fingerprint });
      } catch (error) {
        form.setFieldValue("error", error instanceof Error ? error.message : "Unable to create the bills.");
      }
    },
  });
  /** The source the form's values name, or null while they are incomplete. */
  function sourceOf(values: { throughDate: string; recipientKind: RecipientKind; classId: string; admissionIds: string[] }): BillDueSource | null {
    if (!values.throughDate) return null;
    const base = { documentType: "bill_due" as const, sessionId: scope.sessionId, throughDate: values.throughDate };
    if (values.recipientKind === "session") return { ...base, recipients: { kind: "session" } };
    if (!values.classId) return null;
    if (values.recipientKind === "class") return { ...base, recipients: { kind: "class", classId: values.classId } };
    return values.admissionIds.length ? { ...base, recipients: { kind: "admissions", admissionIds: values.admissionIds } } : null;
  }
  return { form, sourceOf };
}

function BillDueForm({
  scope,
  session,
  templateId,
  onHistory,
}: {
  scope: DocumentScope;
  session: StatementReadySession;
  templateId: string;
  onHistory: () => void;
}) {
  const { form, sourceOf } = useBillDueForm(scope, session, templateId);
  const resetResult = () => {
    form.setFieldValue("preview", null);
    form.setFieldValue("generated", null);
    form.setFieldValue("error", "");
  };
  const submit = (mode: "preview" | "generate") => {
    form.setFieldValue("mode", mode);
    void form.handleSubmit();
  };
  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <section className="flex min-w-0 flex-col gap-4">
        <form.Field name="throughDate">{(field) => <BillDateField field={field} session={session} onChange={resetResult} />}</form.Field>
        <form.Field name="recipientKind">
          {(field) => (
            <DocumentSelect
              field={field}
              label="Bills for"
              options={recipientOptions}
              onValueChange={(kind) => {
                if (kind !== "admissions") form.setFieldValue("admissionIds", []);
                resetResult();
              }}
            />
          )}
        </form.Field>
        <form.Subscribe selector={(state) => state.values.recipientKind}>
          {(kind) => (kind === "session" ? null : <BillDueRecipients form={form} scope={scope} kind={kind} onChange={resetResult} />)}
        </form.Subscribe>
      </section>
      <form.Subscribe selector={(state) => ({ values: state.values, submitting: state.isSubmitting, canSubmit: state.canSubmit })}>
        {({ values, submitting, canSubmit }) => {
          const source = sourceOf(values);
          const fingerprint = source ? JSON.stringify({ source, templateId }) : "";
          return (
            <FinancePreviewPanel
              state={{
                ready: Boolean(source),
                preview: values.preview?.fingerprint === fingerprint ? values.preview : null,
                job: values.generated?.fingerprint === fingerprint ? values.generated.job : null,
                error: values.error,
                submitting,
                mode: values.mode,
                canSubmit,
              }}
              documentType="bill_due"
              documentsLabel="bills"
              scope={scope}
              onPreview={() => submit("preview")}
              onCreate={() => submit("generate")}
              onHistory={onHistory}
            />
          );
        }}
      </form.Subscribe>
    </div>
  );
}

type BillDueFormApi = ReturnType<typeof useBillDueForm>["form"];

/**
 * The class, and for chosen students the students of that class, with the
 * Documents workspace's own controls. Choosing another class clears the
 * chosen students. The pickers read classes and students, so they need those
 * permissions; the whole session needs neither.
 */
function BillDueRecipients({ form, scope, kind, onChange }: { form: BillDueFormApi; scope: DocumentScope; kind: Exclude<RecipientKind, "session">; onChange: () => void }) {
  return (
    <RequirePermissions
      permissions={[
        documentPermission(scope.schoolId, SCHOOL_ACTIONS.READ_CLASS),
        documentPermission(scope.schoolId, SCHOOL_ACTIONS.READ_STUDENT),
      ]}
      fallback={<DocumentNotice>You do not have access to classes and students. Create bills for the whole session instead.</DocumentNotice>}
    >
      <form.Field name="classId">
        {(field) => (
          <SchoolClassSelect
            scope={scope}
            field={field}
            onValueChange={() => {
              form.setFieldValue("admissionIds", []);
              onChange();
            }}
          />
        )}
      </form.Field>
      {kind === "admissions" ? (
        <form.Subscribe selector={(state) => state.values.classId}>
          {(classId) =>
            classId ? (
              <form.Field name="admissionIds">
                {(field) => (
                  <StudentPicker
                    scope={scope}
                    classId={classId}
                    selected={field.state.value}
                    selectBy="admission"
                    errors={field.state.meta.errors}
                    onChange={(ids) => {
                      field.handleChange(ids);
                      onChange();
                    }}
                  />
                )}
              </form.Field>
            ) : null
          }
        </form.Subscribe>
      ) : null}
    </RequirePermissions>
  );
}

type BillDueDialogProps = {
  schoolId: string;
  admissionId: string;
  /** The ledger's session the bill is for, with its finance readiness. */
  session: StatementSession | undefined;
  onClose: () => void;
};

/**
 * The admission ledger's **Bill** dialog: a Bill due for this admission as
 * of a date (today by default), created in the background and offered for
 * download once ready. Permission checks wrap the component that reads the
 * bill template, so it never mounts without them.
 */
export function BillDueDialog(props: BillDueDialogProps) {
  const resource = { kind: "school" as const, schoolId: props.schoolId };
  return (
    <RequirePermissions
      permissions={[
        { action: SCHOOL_ACTIONS.GENERATE_FINANCE_DOCUMENTS, resource },
        { action: SCHOOL_ACTIONS.READ_FINANCE_DOCUMENT_TEMPLATES, resource },
        { action: SCHOOL_ACTIONS.READ_SESSION_FINANCE, resource },
        { action: SCHOOL_ACTIONS.READ_ADMISSION_LEDGER, resource },
      ]}
    >
      <BillDueDialogShell {...props} />
    </RequirePermissions>
  );
}

function BillDueDialogShell({ schoolId, admissionId, session, onClose }: BillDueDialogProps) {
  const template = useQuery(orpc.school.getActiveDocumentTemplate.queryOptions({ input: { schoolId, documentType: "bill" } }));
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bill</DialogTitle>
          <DialogDescription>
            A bill as of a date: everything billed in its billing period, the payments and other credits up to the end of the date, and the amount due.
          </DialogDescription>
        </DialogHeader>
        {template.isPending ? (
          <DocumentLoading />
        ) : template.isError ? (
          <DocumentReadError error={template.error} retry={template.refetch} />
        ) : !template.data ? (
          <DocumentNotice>Select a bill template in Settings › Templates before creating a bill.</DocumentNotice>
        ) : !isReadyStatementSession(session) ? (
          <SessionRequirement session={session} />
        ) : (
          <BillDueDialogForm
            key={`${session.id}:${template.data.revisionId}`}
            schoolId={schoolId}
            admissionId={admissionId}
            session={session}
            templateId={template.data.revisionId}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function BillDueDialogForm({
  schoolId,
  admissionId,
  session,
  templateId,
  onClose,
}: {
  schoolId: string;
  admissionId: string;
  session: StatementReadySession;
  templateId: string;
  onClose: () => void;
}) {
  const mutation = useMutation({
    mutationFn: async (throughDate: string) => {
      const source: BillDueSource = { documentType: "bill_due", sessionId: session.id, throughDate, recipients: { kind: "admissions", admissionIds: [admissionId] } };
      const preview = await previewBillDue(schoolId, source, templateId, "");
      const generated = await client.school.generateDocument({ schoolId, source: { ...source, expectedReviewHash: preview.reviewHash }, templateRevisionId: templateId });
      return generated.job;
    },
  });
  const form = useForm({
    defaultValues: { throughDate: getStatementDateBounds(session).defaultDate },
    validators: { onChange: z.object({ throughDate: billDateSchema(session) }) },
    onSubmit: ({ value }) => mutation.mutateAsync(value.throughDate).then(() => undefined, () => undefined),
  });
  if (mutation.data)
    return (
      <div className="flex flex-col gap-4">
        <DocumentJobTracker
          schoolId={schoolId}
          job={mutation.data}
          ready={(artifactId) => (
            <RequirePermissions
              permissions={documentPermission(schoolId, SCHOOL_ACTIONS.READ_FINANCE_DOCUMENT_ARTIFACTS)}
              fallback={<p className="text-xs text-muted-foreground">You do not have permission to download finance documents.</p>}
            >
              <DocumentDownload schoolId={schoolId} artifactId={artifactId} documentType="bill_due" />
            </RequirePermissions>
          )}
        />
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </div>
    );
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <form.Field name="throughDate">{(field) => <BillDateField field={field} session={session} onChange={() => mutation.reset()} />}</form.Field>
      {mutation.error ? <p className="text-sm text-destructive">{mutation.error.message}</p> : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, submitting: state.isSubmitting })}>
          {({ canSubmit, submitting }) => (
            <Button type="submit" disabled={!canSubmit || submitting}>
              {submitting ? "Creating…" : "Create bill"}
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
}
