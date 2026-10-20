"use client";

import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, Eye, FileDown, Search } from "lucide-react";
import { z } from "zod";
import type { DocumentSource } from "@campuspilot/api/routers/school/document/document.dto";
import { formatMinor } from "@campuspilot/components/finance";
import {
  DocumentButton,
  DocumentErrors,
  DocumentNotice,
  DocumentPreview,
} from "@campuspilot/components/documents/document-controls";
import { Badge } from "@campuspilot/ui/components/badge";
import { Input } from "@campuspilot/ui/components/input";
import { RequirePermissions } from "@/components/require-permissions";
import { client, orpc } from "@/lib/orpc";
import { SimplePagination } from "@/components/billing/finance-ui";
import {
  DocumentLoading,
  DocumentReadError,
  SCHOOL_ACTIONS,
  documentPermission,
  useDocumentCache,
  type DocumentScope,
} from "./document-common";
import { DocumentDownload } from "./document-generator";

type FinanceDocumentType = "bill" | "receipt";
type FinanceSource = Extract<
  DocumentSource,
  { documentType: FinanceDocumentType }
>;
type Preview = {
  html: string;
  warnings: string[];
  recipientCount: number;
  fingerprint: string;
};
type GeneratedArtifact = { id: string; fingerprint: string };
type Selection = { id: string; label: string };

const selectionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});

function generationFingerprint(source: FinanceSource, templateId: string) {
  return JSON.stringify({ source, templateId });
}

/** Finance generation reads billing sources as well as templates. Keeping the
 * query-owning component behind this complete permission set prevents partial
 * access from mounting protected template, run, or ledger queries. */
export function FinanceDocumentGenerator({
  scope,
  documentType,
  onHistory,
}: {
  scope: DocumentScope;
  documentType: FinanceDocumentType;
  onHistory: () => void;
}) {
  const actions = [
    SCHOOL_ACTIONS.GENERATE_FINANCE_DOCUMENTS,
    SCHOOL_ACTIONS.READ_FINANCE_DOCUMENT_TEMPLATES,
    SCHOOL_ACTIONS.READ_SESSION_FINANCE,
    SCHOOL_ACTIONS.READ_ADMISSION_LEDGER,
    ...(documentType === "bill" ? [SCHOOL_ACTIONS.READ_BILLING_RUNS] : []),
  ];
  return (
    <RequirePermissions
      permissions={actions.map((action) =>
        documentPermission(scope.schoolId, action),
      )}
      fallback={
        <DocumentNotice>
          You do not have access to all data required for this finance export.
        </DocumentNotice>
      }
    >
      <FinanceDocumentGeneratorData
        scope={scope}
        documentType={documentType}
        onHistory={onHistory}
      />
    </RequirePermissions>
  );
}

function FinanceDocumentGeneratorData({
  scope,
  documentType,
  onHistory,
}: {
  scope: DocumentScope;
  documentType: FinanceDocumentType;
  onHistory: () => void;
}) {
  const template = useQuery(
    orpc.school.getActiveDocumentTemplate.queryOptions({
      input: { schoolId: scope.schoolId, documentType },
    }),
  );
  if (template.isPending) return <DocumentLoading />;
  if (template.isError)
    return <DocumentReadError error={template.error} retry={template.refetch} />;
  if (!template.data)
    return (
      <DocumentNotice>
        Configure the {documentType} template in School settings before
        creating this PDF.
      </DocumentNotice>
    );
  const props = {
    scope,
    templateId: template.data.artifact.id,
    onHistory,
  };
  return documentType === "bill" ? (
    <BillGenerator key={template.data.artifact.id} {...props} />
  ) : (
    <ReceiptGenerator key={template.data.artifact.id} {...props} />
  );
}

function useFinanceGeneration({
  scope,
  templateId,
  searchMax,
  sourceFor,
}: {
  scope: DocumentScope;
  templateId: string;
  searchMax: 100 | 200;
  sourceFor: (values: {
    billRunId: string;
    selected: Selection[];
  }) => FinanceSource | null;
}) {
  const cache = useDocumentCache();
  const form = useForm({
    defaultValues: {
      search: "",
      page: 1,
      billRunId: "",
      selected: [] as Selection[],
      mode: "preview" as "preview" | "generate",
      preview: null as Preview | null,
      generated: null as GeneratedArtifact | null,
      error: "",
    },
    validators: {
      onChange: z.object({
        search: z.string().max(searchMax),
        page: z.number().int().positive(),
        billRunId: z.string(),
        selected: z.array(selectionSchema).max(500),
        mode: z.enum(["preview", "generate"]),
        preview: z
          .object({
            html: z.string(),
            warnings: z.array(z.string()),
            recipientCount: z.number().int().nonnegative(),
            fingerprint: z.string(),
          })
          .nullable(),
        generated: z
          .object({ id: z.string().min(1), fingerprint: z.string().min(1) })
          .nullable(),
        error: z.string(),
      }),
    },
    onSubmit: async ({ value }) => {
      const source = sourceFor(value);
      if (!source) return;
      const fingerprint = generationFingerprint(source, templateId);
      form.setFieldValue("error", "");
      try {
        if (value.mode === "preview") {
          form.setFieldValue("generated", null);
          const preview = await client.school.previewDocument({
            schoolId: scope.schoolId,
            source,
            templateRevisionId: templateId,
          });
          form.setFieldValue("preview", {
            html: preview.html,
            warnings: preview.warnings,
            recipientCount: preview.studentCount,
            fingerprint,
          });
          return;
        }
        if (value.preview?.fingerprint !== fingerprint) {
          throw new Error("Preview the current selection before creating its PDF.");
        }
        const generated = await client.school.generateDocument({
          schoolId: scope.schoolId,
          source,
          templateRevisionId: templateId,
        });
        form.setFieldValue("generated", {
          id: generated.artifact.id,
          fingerprint,
        });
        await cache.artifacts(scope.schoolId);
      } catch (error) {
        form.setFieldValue(
          "error",
          error instanceof Error ? error.message : "Unable to create the PDF.",
        );
      }
    },
  });
  return form;
}

type GeneratorProps = {
  scope: DocumentScope;
  templateId: string;
  onHistory: () => void;
};

function BillGenerator({ scope, templateId, onHistory }: GeneratorProps) {
  const sourceFor = (values: { billRunId: string; selected: Selection[] }) =>
    values.billRunId
      ? ({
          documentType: "bill" as const,
          sessionId: scope.sessionId,
          billRunId: values.billRunId,
        } satisfies FinanceSource)
      : null;
  const form = useFinanceGeneration({
    scope,
    templateId,
    searchMax: 100,
    sourceFor,
  });
  return (
    <form.Subscribe selector={(state) => state.values}>
      {(values) => (
        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <form.Field name="search">
            {(field) => (
              <BillRunPicker
                scope={scope}
                values={{
                  search: field.state.value,
                  page: values.page,
                  billRunId: values.billRunId,
                }}
                searchErrors={field.state.meta.errors}
                onSearch={(search) => {
                  field.handleChange(search);
                  form.setFieldValue("page", 1);
                  form.setFieldValue("billRunId", "");
                  form.setFieldValue("preview", null);
                  form.setFieldValue("generated", null);
                  form.setFieldValue("error", "");
                }}
                onPage={(page) => {
                  form.setFieldValue("page", page);
                  form.setFieldValue("billRunId", "");
                  form.setFieldValue("preview", null);
                  form.setFieldValue("generated", null);
                  form.setFieldValue("error", "");
                }}
                onSelect={(billRunId) => {
                  form.setFieldValue("billRunId", billRunId);
                  form.setFieldValue("preview", null);
                  form.setFieldValue("generated", null);
                  form.setFieldValue("error", "");
                }}
              />
            )}
          </form.Field>
          <FinancePreviewAndActions
            form={form}
            source={sourceFor(values)}
            documentType="bill"
            templateId={templateId}
            scope={scope}
            onHistory={onHistory}
          />
        </div>
      )}
    </form.Subscribe>
  );
}

function BillRunPicker({
  scope,
  values,
  searchErrors,
  onSearch,
  onPage,
  onSelect,
}: {
  scope: DocumentScope;
  values: { search: string; page: number; billRunId: string };
  searchErrors: readonly unknown[];
  onSearch: (value: string) => void;
  onPage: (value: number) => void;
  onSelect: (value: string) => void;
}) {
  const runs = useQuery(
    orpc.school.listBillingRuns.queryOptions({
      input: {
        schoolId: scope.schoolId,
        searchQuery: values.search,
        filters: {
          sessionId: scope.sessionId,
        },
        page: values.page,
        limit: 10,
        orderBy: { field: "issueDate", direction: "desc" },
      },
    }),
  );
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
        <Input
          value={values.search}
          className="pl-9"
          placeholder="Search billing periods…"
          aria-label="Search billing runs"
          aria-invalid={searchErrors.length > 0}
          aria-describedby="billing-run-search-errors"
          maxLength={100}
          onChange={(event) => onSearch(event.target.value)}
        />
      </div>
      <div id="billing-run-search-errors">
        <DocumentErrors errors={searchErrors} />
      </div>
      {runs.isPending ? <DocumentLoading /> : null}
      {runs.isError ? (
        <DocumentReadError error={runs.error} retry={runs.refetch} />
      ) : null}
      {runs.data ? (
        <>
          <div className="flex flex-col gap-2">
            {runs.data.items.map((run) => {
              const disabled = run.status !== "posted" || run.billCount === 0;
              const selected = values.billRunId === run.id;
              return (
                <button
                  key={run.id}
                  type="button"
                  disabled={disabled}
                  aria-pressed={selected}
                  onClick={() => onSelect(run.id)}
                  className={`flex min-w-0 flex-col gap-2 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${selected ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{run.periodKey}</span>
                    <Badge variant={disabled ? "secondary" : "outline"}>
                      {run.fullyReversed ? "Fully reversed" : run.status}
                    </Badge>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Billing date {run.issueDate} · {run.billCount} bills ·{" "}
                    {formatMinor(run.totalAmountMinor, run.currency)}
                  </span>
                </button>
              );
            })}
            {!runs.data.items.length ? (
              <DocumentNotice>
                No posted billing runs match this search.
              </DocumentNotice>
            ) : null}
          </div>
          <SimplePagination
            currentPage={runs.data.pagination.currentPage}
            totalPages={runs.data.pagination.totalPages}
            onPageChange={onPage}
          />
        </>
      ) : null}
    </section>
  );
}

function ReceiptGenerator({ scope, templateId, onHistory }: GeneratorProps) {
  const sourceFor = (values: { billRunId: string; selected: Selection[] }) =>
    values.selected.length
      ? ({
          documentType: "receipt" as const,
          sessionId: scope.sessionId,
          selectionPolicy: "posted_unreversed_payments" as const,
          transactions: values.selected.map(({ id }) => ({
            kind: "payment" as const,
            id,
          })),
        } satisfies FinanceSource)
      : null;
  const form = useFinanceGeneration({
    scope,
    templateId,
    searchMax: 200,
    sourceFor,
  });
  return (
    <form.Subscribe selector={(state) => state.values}>
      {(values) => (
        <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <form.Field name="search">
            {(field) => (
              <ReceiptPicker
                scope={scope}
                values={{
                  search: field.state.value,
                  page: values.page,
                  selected: values.selected,
                }}
                searchErrors={field.state.meta.errors}
                onSearch={(search) => {
                  field.handleChange(search);
                  form.setFieldValue("page", 1);
                }}
                onPage={(page) => form.setFieldValue("page", page)}
                onSelected={(selected) => {
                  form.setFieldValue("selected", selected);
                  form.setFieldValue("preview", null);
                  form.setFieldValue("generated", null);
                  form.setFieldValue("error", "");
                }}
              />
            )}
          </form.Field>
          <FinancePreviewAndActions
            form={form}
            source={sourceFor(values)}
            documentType="receipt"
            templateId={templateId}
            scope={scope}
            onHistory={onHistory}
          />
        </div>
      )}
    </form.Subscribe>
  );
}

function ReceiptPicker({
  scope,
  values,
  searchErrors,
  onSearch,
  onPage,
  onSelected,
}: {
  scope: DocumentScope;
  values: { search: string; page: number; selected: Selection[] };
  searchErrors: readonly unknown[];
  onSearch: (value: string) => void;
  onPage: (value: number) => void;
  onSelected: (value: Selection[]) => void;
}) {
  const payments = useQuery(
    orpc.school.listPayments.queryOptions({
      input: {
        schoolId: scope.schoolId,
        filters: {
          sessionId: scope.sessionId,
          ...(values.search ? { search: values.search } : {}),
        },
        page: values.page,
        limit: 20,
        orderBy: { field: "receivedAt", direction: "desc" },
      },
    }),
  );
  const selectedIds = new Set(values.selected.map(({ id }) => id));
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <Input
        value={values.search}
        placeholder="Search receipt, admission, or reference…"
        aria-label="Search payments"
        aria-invalid={searchErrors.length > 0}
        aria-describedby="receipt-search-errors"
        maxLength={200}
        onChange={(event) => onSearch(event.target.value)}
      />
      <div id="receipt-search-errors">
        <DocumentErrors errors={searchErrors} />
      </div>
      <p className="text-xs text-muted-foreground">
        {values.selected.length} of 500 payments selected across pages
      </p>
      {values.selected.length ? (
        <div className="flex max-h-24 flex-wrap gap-2 overflow-y-auto">
          {values.selected.map((item) => (
            <DocumentButton
              key={item.id}
              size="sm"
              variant="secondary"
              onClick={() =>
                onSelected(values.selected.filter(({ id }) => id !== item.id))
              }
            >
              {item.label} <span aria-hidden>×</span>
              <span className="sr-only">Remove {item.label}</span>
            </DocumentButton>
          ))}
        </div>
      ) : null}
      {payments.isPending ? <DocumentLoading /> : null}
      {payments.isError ? (
        <DocumentReadError error={payments.error} retry={payments.refetch} />
      ) : null}
      {payments.data ? (
        <>
          <div className="flex flex-col gap-1">
            {payments.data.items.map((payment) => {
              const selected = selectedIds.has(payment.id);
              const disabled =
                payment.reversed || (!selected && values.selected.length >= 500);
              return (
                <DocumentButton
                  key={payment.id}
                  variant={selected ? "secondary" : "ghost"}
                  className="justify-between"
                  disabled={disabled}
                  onClick={() =>
                    onSelected(
                      selected
                        ? values.selected.filter(({ id }) => id !== payment.id)
                        : [
                            ...values.selected,
                            {
                              id: payment.id,
                              label: `${payment.receiptNumber} · ${payment.admissionName}`,
                            },
                          ],
                    )
                  }
                >
                  <span className="truncate">
                    {payment.receiptNumber} · {payment.admissionName}
                  </span>
                  <span>
                    {payment.reversed
                      ? "Reversed"
                      : selected
                        ? "Selected"
                        : "Add"}
                  </span>
                </DocumentButton>
              );
            })}
          </div>
          <SimplePagination
            currentPage={payments.data.pagination.currentPage}
            totalPages={payments.data.pagination.totalPages}
            onPageChange={onPage}
          />
        </>
      ) : null}
    </section>
  );
}

function FinancePreviewAndActions({
  form,
  source,
  documentType,
  templateId,
  scope,
  onHistory,
}: {
  form: ReturnType<typeof useFinanceGeneration>;
  source: FinanceSource | null;
  documentType: FinanceDocumentType;
  templateId: string;
  scope: DocumentScope;
  onHistory: () => void;
}) {
  return (
    <form.Subscribe
      selector={(state) => ({
        values: state.values,
        submitting: state.isSubmitting,
        canSubmit: state.canSubmit,
      })}
    >
      {({ values, submitting, canSubmit }) => {
        const fingerprint = source
          ? generationFingerprint(source, templateId)
          : "";
        const previewCurrent = values.preview?.fingerprint === fingerprint;
        const generatedCurrent = values.generated?.fingerprint === fingerprint;
        return (
          <section className="flex min-w-0 flex-col gap-3">
            {previewCurrent
              ? values.preview?.warnings.map((warning) => (
                  <DocumentNotice key={warning}>{warning}</DocumentNotice>
                ))
              : null}
            {values.error ? (
              <DocumentNotice error>{values.error}</DocumentNotice>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <DocumentButton
                variant="outline"
                disabled={!source || submitting || !canSubmit}
                onClick={() => {
                  form.setFieldValue("mode", "preview");
                  void form.handleSubmit();
                }}
              >
                <Eye />
                {submitting && values.mode === "preview"
                  ? "Preparing preview…"
                  : "Preview document"}
              </DocumentButton>
              <DocumentButton
                disabled={!source || submitting || !canSubmit || !previewCurrent}
                onClick={() => {
                  form.setFieldValue("mode", "generate");
                  void form.handleSubmit();
                }}
              >
                <FileDown />
                {submitting && values.mode === "generate"
                  ? "Creating PDF…"
                  : "Create PDF"}
              </DocumentButton>
            </div>
            {previewCurrent ? (
              <p className="text-xs text-muted-foreground">
                Preview contains {values.preview?.recipientCount ?? 0}{" "}
                {documentType === "bill" ? "bills" : "receipts"}.
              </p>
            ) : null}
            <DocumentPreview
              html={previewCurrent ? values.preview?.html : undefined}
            />
            {generatedCurrent && values.generated ? (
              <div className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
                <p role="status" className="flex items-center gap-2 text-sm font-medium">
                  <CheckCircle2 className="size-4" /> Your PDF is ready
                </p>
                <RequirePermissions
                  permissions={documentPermission(
                    scope.schoolId,
                    SCHOOL_ACTIONS.READ_FINANCE_DOCUMENT_ARTIFACTS,
                  )}
                  fallback={
                    <DocumentNotice>
                      The PDF was created, but your account cannot download
                      finance documents.
                    </DocumentNotice>
                  }
                >
                  <DocumentDownload
                    schoolId={scope.schoolId}
                    artifactId={values.generated.id}
                    documentType={documentType}
                  />
                  <DocumentButton variant="ghost" onClick={onHistory}>
                    View document history <ArrowRight />
                  </DocumentButton>
                </RequirePermissions>
              </div>
            ) : null}
          </section>
        );
      }}
    </form.Subscribe>
  );
}
