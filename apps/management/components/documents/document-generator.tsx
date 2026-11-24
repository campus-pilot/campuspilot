"use client";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { ArrowRight, Eye, FileDown } from "lucide-react";
import {
  DocumentButton,
  DocumentCheckbox,
  DocumentErrors,
  DocumentNotice,
  DocumentPanel,
  DocumentPreview,
  DocumentSelect,
} from "@campuspilot/components/documents/document-controls";
import {
  DOCUMENT_LABELS,
  DEFAULT_REPORT_SECTIONS,
  MAX_DOCUMENT_SOURCE_ITEMS,
  type DocumentGenerationJobDto,
  type DocumentSource,
  type AcademicDocumentType,
  type DocumentType,
} from "@campuspilot/api/routers/school/document/document.dto";
import { client, orpc } from "@/lib/orpc";
import { RequirePermissions } from "@/components/require-permissions";
import { documentWorkspacePermissions } from "./document-export-link";
import {
  DocumentLoading,
  DocumentPermission,
  DocumentReadError,
  SCHOOL_ACTIONS,
  useDocumentCache,
  type DocumentScope,
} from "./document-common";
import { StudentPicker } from "./student-recipient-picker";
import { DocumentJobTracker } from "./document-job";
import type { DocumentInitialSelection } from "./document-workspace";

type Preview = {
  html: string;
  studentCount: number;
  documentCount: number;
  sampleCount: number;
  warnings: string[];
  fingerprint: string;
};
export function DocumentGenerator({
  scope,
  documentType,
  initial,
  onHistory,
}: {
  scope: DocumentScope;
  documentType: AcademicDocumentType;
  initial: DocumentInitialSelection;
  onHistory: () => void;
}) {
  return (
    <RequirePermissions
      permissions={documentWorkspacePermissions(scope.schoolId, documentType)}
      fallback={
        <DocumentNotice>
          You do not have access to the data needed to create this document.
        </DocumentNotice>
      }
    >
      <DocumentGeneratorData
        scope={scope}
        documentType={documentType}
        initial={initial}
        onHistory={onHistory}
      />
    </RequirePermissions>
  );
}
function DocumentGeneratorData({
  scope,
  documentType,
  initial,
  onHistory,
}: {
  scope: DocumentScope;
  documentType: AcademicDocumentType;
  initial: DocumentInitialSelection;
  onHistory: () => void;
}) {
  const template = useQuery(
    orpc.school.getActiveDocumentTemplate.queryOptions({
      input: { schoolId: scope.schoolId, documentType },
    }),
  );
  if (template.isPending) return <DocumentLoading />;
  if (template.isError)
    return (
      <DocumentReadError error={template.error} retry={template.refetch} />
    );
  if (!template.data)
    return (
      <DocumentPanel
        title={`${DOCUMENT_LABELS[documentType]} need a template`}
        description="Template selection is managed in Settings › Templates so every academic session uses the same approved design."
      >
        <DocumentNotice>
          Use the setup warning in the app header to open template settings. If
          you cannot configure templates, ask a school manager to do it.
        </DocumentNotice>
      </DocumentPanel>
    );
  return (
    <GenerationForm
      key={template.data.artifact.id}
      scope={scope}
      documentType={documentType}
      initial={initial}
      template={{
        id: template.data.artifact.id,
        name: template.data.artifact.name,
      }}
      onHistory={onHistory}
    />
  );
}
/** Holds preview/generation state in TanStack Form. A preview is valid only
 * for its explicit recipient/exam selection and immutable template revision.
 * Previewing is optional: `generate` starts the PDF job for the current
 * selection (the server checks the same selection again; a preview is only
 * for looking). The job runs in the background; `job` is what the server
 * accepted, and its progress is read by `DocumentJobTracker`.
 */
function useDocumentGeneration({
  scope,
  documentType,
  initial,
  template,
}: {
  scope: DocumentScope;
  documentType: AcademicDocumentType;
  initial: DocumentInitialSelection;
  template: { id: string; name: string };
}) {
  const cache = useDocumentCache();
  const schema = z
    .object({
      classId:
        documentType === "timetable" ||
        documentType === "report_card" ||
        documentType === "admit_card"
          ? z.string()
          : z.string().min(1, "Choose a class"),
      examSlug:
        documentType === "id_card"
          ? z.string()
          : z.string().min(1, "Choose an examination"),
      audience: z.enum(["all", "selected"]),
      studentIds: z.array(z.string()).max(MAX_DOCUMENT_SOURCE_ITEMS),
      reportSections: z.object({
        includeModeMarks: z.boolean(),
        includeAttendance: z.boolean(),
        includeCoScholastics: z.boolean(),
        includeGradingScale: z.boolean(),
      }),
      resultPolicy: z.enum(["require_all", "approved_only"]),
      mode: z.enum(["preview", "generate"]),
      error: z.string(),
      preview: z.custom<Preview>().nullable(),
      job: z.custom<DocumentGenerationJobDto>().nullable(),
    })
    .superRefine((value, ctx) => {
      if (
        documentType !== "timetable" &&
        value.audience === "selected" &&
        value.studentIds.length === 0
      )
        ctx.addIssue({
          code: "custom",
          path: ["studentIds"],
          message: "Select at least one student",
        });
      if (
        documentType !== "timetable" &&
        value.audience === "selected" &&
        !value.classId
      )
        ctx.addIssue({
          code: "custom",
          path: ["classId"],
          message: "Choose a class before selecting students",
        });
    });
  const sourceFor = (value: {
    classId: string;
    examSlug: string;
    audience: string;
    studentIds: string[];
    reportSections: typeof DEFAULT_REPORT_SECTIONS;
    resultPolicy: "approved_only" | "require_all";
  }): DocumentSource => {
    if (documentType === "timetable")
      return {
        documentType,
        sessionId: scope.sessionId,
        examSlug: value.examSlug,
      };
    const selection = {
      sessionId: scope.sessionId,
      ...(value.classId ? { classId: value.classId } : {}),
      ...(value.audience === "selected"
        ? { studentIds: value.studentIds }
        : {}),
    };
    if (documentType === "report_card")
      return {
        documentType,
        ...selection,
        classId: value.classId || undefined,
        examSlug: value.examSlug,
        reportSections: value.reportSections,
        resultPolicy: value.resultPolicy,
      };
    return documentType === "id_card"
      ? {
          documentType,
          sessionId: scope.sessionId,
          classId: value.classId,
          ...(value.audience === "selected"
            ? { studentIds: value.studentIds }
            : {}),
        }
      : { documentType, ...selection, examSlug: value.examSlug };
  };
  const form = useForm({
    defaultValues: {
      classId: initial.classId ?? "",
      examSlug: initial.examSlug ?? "",
      audience: (initial.studentId ? "selected" : "all") as "selected" | "all",
      studentIds: initial.studentId ? [initial.studentId] : ([] as string[]),
      reportSections: DEFAULT_REPORT_SECTIONS,
      resultPolicy: "approved_only" as "approved_only" | "require_all",
      mode: "preview" as GenerationMode,
      error: "",
      preview: null as Preview | null,
      job: null as DocumentGenerationJobDto | null,
    },
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      form.setFieldValue("error", "");
      const source = sourceFor(value);
      try {
        if (value.mode === "preview") {
          const preview = await client.school.previewDocument({
            schoolId: scope.schoolId,
            source,
            templateRevisionId: template.id,
          });
          form.setFieldValue("preview", {
            ...preview,
            fingerprint: JSON.stringify(source),
          });
          form.setFieldValue("job", null);
        } else {
          const result = await client.school.generateDocument({
            schoolId: scope.schoolId,
            source,
            templateRevisionId: template.id,
          });
          form.setFieldValue("job", result.job);
        }
      } catch (error) {
        form.setFieldValue(
          "error",
          error instanceof Error
            ? error.message
            : "Unable to create this document.",
        );
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "CONFLICT"
        )
          await cache.templates({ schoolId: scope.schoolId, documentType });
      }
    },
  });
  return { form, sourceFor };
}
function GenerationForm({
  scope,
  documentType,
  initial,
  template,
  onHistory,
}: {
  scope: DocumentScope;
  documentType: AcademicDocumentType;
  initial: DocumentInitialSelection;
  template: { id: string; name: string };
  onHistory: () => void;
}) {
  const { form, sourceFor } = useDocumentGeneration({
    scope,
    documentType,
    initial,
    template,
  });
  return (
    <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
      <DocumentPanel
        title="Create a document"
        description="Choose the data to include and download the PDF. Preview it first if you want to check it."
      >
        <p className="rounded-lg bg-primary/5 p-3 text-sm">
          <span className="text-muted-foreground">Selected template</span>
          <br />
          <strong>{template.name}</strong>
        </p>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            form.setFieldValue("mode", "preview");
            void form.handleSubmit();
          }}
        >
          {documentType !== "id_card" && (
            <form.Field name="examSlug">
              {(field) => (
                <ExamSelector
                  scope={scope}
                  field={field}
                  onValueChange={() => {
                    // The class choice belongs to the examination: another
                    // examination may not include the chosen class.
                    form.setFieldValue("classId", "");
                    form.setFieldValue("studentIds", []);
                  }}
                />
              )}
            </form.Field>
          )}
          {documentType === "timetable" ? (
            <DocumentNotice>
              The timetable PDF includes every class taking part in this
              examination.
            </DocumentNotice>
          ) : (
            <form.Field name="classId">
              {(field) => (
                <ClassSelector
                  scope={scope}
                  documentType={documentType}
                  form={form}
                  field={field}
                />
              )}
            </form.Field>
          )}
          {documentType !== "timetable" && (
            <>
              <form.Field name="audience">
                {(field) => (
                  <DocumentSelect
                    field={field}
                    label="Recipients"
                    options={[
                      {
                        value: "all",
                        label:
                          "All registered students in the selected classes",
                      },
                      { value: "selected", label: "Select students" },
                    ]}
                  />
                )}
              </form.Field>
              <form.Subscribe
                selector={(state) => ({
                  audience: state.values.audience,
                  classId: state.values.classId,
                })}
              >
                {(values) =>
                  values.audience === "selected" &&
                  values.classId && (
                    <form.Field name="studentIds">
                      {(field) => (
                        <StudentPicker
                          key={values.classId}
                          scope={scope}
                          classId={values.classId}
                          selected={field.state.value}
                          onChange={field.handleChange}
                          errors={field.state.meta.errors}
                        />
                      )}
                    </form.Field>
                  )
                }
              </form.Subscribe>
            </>
          )}
          {documentType === "report_card" && <ReportOptions form={form} />}
          <GenerationActions
            form={form}
            scope={scope}
            documentType={documentType}
            onHistory={onHistory}
          />
        </form>
      </DocumentPanel>
      <form.Subscribe selector={(state) => state.values}>
        {(values) => (
          <div className="flex flex-col gap-3">
            {values.preview &&
              values.preview.fingerprint !==
                JSON.stringify(sourceFor(values)) && (
                <DocumentNotice>
                  Your selection changed. Preview again to see the updated
                  document.
                </DocumentNotice>
              )}
            {values.preview?.warnings.map((warning) => (
              <DocumentNotice key={warning}>{warning}</DocumentNotice>
            ))}
            <DocumentPreview
              html={values.preview?.html}
              label={values.preview ? previewLabel(values.preview) : "Print preview"}
            />
          </div>
        )}
      </form.Subscribe>
    </div>
  );
}
/**
 * The preview caption: the whole selection's student count, and which of its
 * documents the sample shows (a preview renders the first two printed sheets).
 */
function previewLabel(preview: Preview) {
  const students = preview.studentCount
    ? ` · ${preview.studentCount.toLocaleString("en-IN")} student${preview.studentCount === 1 ? "" : "s"}`
    : "";
  const sample =
    preview.sampleCount < preview.documentCount
      ? ` · showing the first ${preview.sampleCount} of ${preview.documentCount.toLocaleString("en-IN")}`
      : "";
  return `Print preview${students}${sample}`;
}
type GenerationFormApi = ReturnType<typeof useDocumentGeneration>["form"];
/** `preview` renders a sample without saving; `generate` starts the PDF job. */
type GenerationMode = "preview" | "generate";
function ReportOptions({ form }: { form: GenerationFormApi }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-2 text-sm font-medium">Report contents</legend>
      {(
        [
          ["includeModeMarks", "Marks by assessment mode"],
          ["includeAttendance", "Attendance"],
          ["includeCoScholastics", "Co-scholastic activities"],
          ["includeGradingScale", "Grading key"],
        ] as const
      ).map(([name, label]) => (
        <form.Field key={name} name={`reportSections.${name}`}>
          {(field) => <DocumentCheckbox field={field} label={label} />}
        </form.Field>
      ))}
      <form.Field name="resultPolicy">
        {(field) => (
          <DocumentSelect
            field={field}
            label="Approval policy"
            options={[
              {
                value: "approved_only",
                label: "Include fully approved students only",
              },
              {
                value: "require_all",
                label: "Require every selected student to be approved",
              },
            ]}
          />
        )}
      </form.Field>
      <p className="text-xs text-muted-foreground">
        Attendance and activities appear when configured and approved. A chosen
        student is never silently excluded. Maximum{" "}
        {MAX_DOCUMENT_SOURCE_ITEMS.toLocaleString("en-IN")} students per PDF.
      </p>
    </fieldset>
  );
}
function GenerationActions({
  form,
  scope,
  documentType,
  onHistory,
}: {
  form: GenerationFormApi;
  scope: DocumentScope;
  documentType: AcademicDocumentType;
  onHistory: () => void;
}) {
  return (
    <form.Subscribe
      selector={(state) => ({
        values: state.values,
        submitting: state.isSubmitting,
        canSubmit: state.canSubmit,
        errors: state.errors,
      })}
    >
      {({ values, submitting, canSubmit, errors }) => (
        <div className="flex flex-col gap-3">
          <DocumentErrors errors={errors} />
          {values.error && (
            <DocumentNotice error>{values.error}</DocumentNotice>
          )}
          <CreatePdfButton
            disabled={submitting || !canSubmit}
            running={submitting && values.mode === "generate"}
            onCreate={() => {
              form.setFieldValue("mode", "generate");
              void form.handleSubmit();
            }}
          />
          <DocumentButton
            type="submit"
            variant="outline"
            disabled={submitting || !canSubmit}
          >
            <Eye />
            {submitting && values.mode === "preview"
              ? "Preparing preview…"
              : "Preview document"}
          </DocumentButton>
          {values.job && (
            <DocumentJobTracker
              key={values.job.id}
              schoolId={scope.schoolId}
              job={values.job}
              ready={(artifactId) => (
                <GenerationReadyActions
                  schoolId={scope.schoolId}
                  artifactId={artifactId}
                  documentType={documentType}
                  onHistory={onHistory}
                />
              )}
            />
          )}
        </div>
      )}
    </form.Subscribe>
  );
}
type StringField =
  import("@campuspilot/components/documents/document-controls").DocumentStringField;
/**
 * The class picker. An examination document (admit card, report card) offers
 * only the classes taking part in the chosen examination (`getExamContext`),
 * so a class excluded from it is never offered; an ID card offers every class
 * of the school. Changing the class clears the chosen students.
 */
function ClassSelector({
  scope,
  documentType,
  form,
  field,
}: {
  scope: DocumentScope;
  documentType: Exclude<AcademicDocumentType, "timetable">;
  form: GenerationFormApi;
  field: StringField;
}) {
  const clearStudents = () => form.setFieldValue("studentIds", []);
  if (documentType === "id_card")
    return (
      <SchoolClassSelect
        scope={scope}
        field={field}
        onValueChange={clearStudents}
      />
    );
  return (
    <form.Subscribe selector={(state) => state.values.examSlug}>
      {(examSlug) => (
        <ExamClassSelect
          scope={scope}
          examSlug={examSlug}
          field={field}
          onValueChange={clearStudents}
        />
      )}
    </form.Subscribe>
  );
}
/** Every class of the school; also the Bill due's class choice (`bill-due.tsx`). */
export function SchoolClassSelect({
  scope,
  field,
  onValueChange,
}: {
  scope: DocumentScope;
  field: StringField;
  onValueChange: () => void;
}) {
  const classes = useQuery(
    orpc.school.listClasses.queryOptions({
      input: { schoolId: scope.schoolId },
    }),
  );
  if (classes.isPending)
    return <DocumentNotice>Loading classes…</DocumentNotice>;
  if (classes.isError)
    return <DocumentReadError error={classes.error} retry={classes.refetch} />;
  return (
    <DocumentSelect
      field={field}
      label="Class"
      onValueChange={onValueChange}
      options={[
        { value: "", label: "Choose a class" },
        ...classes.data.map((entry) => ({
          value: entry.id,
          label: entry.label,
        })),
      ]}
    />
  );
}
/** Classes of an examination document: "all" plus each class taking part in
 * the chosen examination. Before an examination is chosen only "all" is
 * offered, and the picker stays disabled. */
function ExamClassSelect({
  scope,
  examSlug,
  field,
  onValueChange,
}: {
  scope: DocumentScope;
  examSlug: string;
  field: StringField;
  onValueChange: () => void;
}) {
  const context = useQuery({
    ...orpc.school.getExamContext.queryOptions({
      input: { ...scope, examSlug },
    }),
    enabled: Boolean(examSlug),
  });
  if (examSlug && context.isPending)
    return <DocumentNotice>Loading classes…</DocumentNotice>;
  if (context.isError)
    return <DocumentReadError error={context.error} retry={context.refetch} />;
  return (
    <DocumentSelect
      field={field}
      label="Classes"
      disabled={!examSlug}
      onValueChange={onValueChange}
      options={[
        { value: "", label: "All examination classes" },
        ...(context.data?.classes ?? []).map((entry) => ({
          value: entry.id,
          label: entry.label,
        })),
      ]}
    />
  );
}
function ExamSelector({
  scope,
  field,
  onValueChange,
}: {
  scope: DocumentScope;
  field: StringField;
  onValueChange?: () => void;
}) {
  const session = useQuery(
    orpc.school.getSession.queryOptions({ input: scope }),
  );
  if (session.isPending)
    return <DocumentNotice>Loading examinations…</DocumentNotice>;
  if (session.isError)
    return <DocumentReadError error={session.error} retry={session.refetch} />;
  const exams = Object.entries(
    session.data.sessionConfig?.examConfig ?? {},
  ).sort(([a, x], [b, y]) => x.order - y.order || a.localeCompare(b));
  return (
    <DocumentSelect
      field={field}
      label="Examination"
      onValueChange={onValueChange}
      options={[
        { value: "", label: "Choose an examination" },
        ...exams.map(([slug, exam]) => ({ value: slug, label: exam.name })),
      ]}
    />
  );
}
/**
 * What a ready PDF offers: its download (for people who may download
 * documents) and the way to history.
 */
function GenerationReadyActions({
  schoolId,
  artifactId,
  documentType,
  onHistory,
}: {
  schoolId: string;
  artifactId: string;
  documentType: AcademicDocumentType;
  onHistory: () => void;
}) {
  return (
    <DocumentPermission
      schoolId={schoolId}
      action={SCHOOL_ACTIONS.READ_DOCUMENT_ARTIFACTS}
      fallback={
        <p className="text-xs text-muted-foreground">
          Your account cannot download documents. Ask a school manager for
          the PDF.
        </p>
      }
    >
      <DocumentDownload
        schoolId={schoolId}
        artifactId={artifactId}
        documentType={documentType}
      />
      <DocumentButton type="button" variant="ghost" onClick={onHistory}>
        View document history
        <ArrowRight />
      </DocumentButton>
    </DocumentPermission>
  );
}
/**
 * The main button of a generation dialog: starts the PDF job. The PDF is
 * created in the background (up to 1,500 documents), so its download is
 * offered once it is ready (`DocumentJobTracker`). It never waits for a
 * preview.
 */
export function CreatePdfButton({
  disabled,
  running,
  onCreate,
}: {
  disabled: boolean;
  /** Whether the request that starts the job is being sent. */
  running: boolean;
  onCreate: () => void;
}) {
  return (
    <DocumentButton type="button" disabled={disabled} onClick={onCreate}>
      <FileDown />
      {running ? "Starting PDF…" : "Create PDF"}
    </DocumentButton>
  );
}
/** Asks for a fresh short-lived URL and navigates to it. The URL is served as
 * an attachment, so the browser downloads it and the page stays. */
async function downloadDocument({
  schoolId,
  artifactId,
  documentType,
}: {
  schoolId: string;
  artifactId: string;
  documentType: DocumentType;
}) {
  const { url } = await client.school.getDocumentDownload({
    schoolId,
    artifactId,
    documentType,
  });
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener noreferrer";
  link.click();
}
/** Issue a fresh short-lived URL on each click, keeping expired URLs out of the
 * history cache. The navigation happens only after the authorization succeeds.
 */
export function DocumentDownload({
  schoolId,
  artifactId,
  documentType,
  label = "Download PDF",
}: {
  schoolId: string;
  artifactId: string;
  documentType: DocumentType;
  label?: string;
}) {
  const form = useForm({
    defaultValues: { error: "" },
    validators: { onChange: z.object({ error: z.string() }) },
    onSubmit: async () => {
      form.setFieldValue("error", "");
      try {
        await downloadDocument({ schoolId, artifactId, documentType });
      } catch (error) {
        form.setFieldValue(
          "error",
          error instanceof Error ? error.message : "Download unavailable.",
        );
      }
    },
  });
  return (
    <form.Subscribe
      selector={(state) => ({
        submitting: state.isSubmitting,
        error: state.values.error,
      })}
    >
      {({ submitting, error }) => (
        <div className="flex flex-col gap-2">
          <DocumentButton
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={() => void form.handleSubmit()}
          >
            <FileDown />
            {submitting ? "Preparing download…" : label}
          </DocumentButton>
          {error && <DocumentNotice error>{error}</DocumentNotice>}
        </div>
      )}
    </form.Subscribe>
  );
}
