'use client';
import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { ArrowRight, Eye, FileDown, CheckCircle2 } from 'lucide-react';
import {
  DocumentButton,
  DocumentErrors,
  DocumentNotice,
  DocumentPanel,
  DocumentPreview,
  DocumentSelect,
} from '@campuspilot/components/documents/document-controls';
import {
  DOCUMENT_LABELS,
  type DocumentSource,
  type DocumentType,
} from '@campuspilot/api/routers/school/document/document.dto';
import { client, orpc } from '@/lib/orpc';
import { RequirePermissions } from '@/components/require-permissions';
import { documentWorkspacePermissions } from './document-export-link';
import {
  DocumentLoading,
  DocumentPermission,
  DocumentReadError,
  SCHOOL_ACTIONS,
  useDocumentCache,
  type DocumentScope,
} from './document-common';
import { StudentPicker } from './student-recipient-picker';
import type { DocumentInitialSelection } from './document-workspace';

type Preview = {
  html: string;
  studentCount: number;
  warnings: string[];
  fingerprint: string;
};
export function DocumentGenerator({
  scope,
  documentType,
  initial,
  onChooseTemplate,
  onHistory,
}: {
  scope: DocumentScope;
  documentType: DocumentType;
  initial: DocumentInitialSelection;
  onChooseTemplate: () => void;
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
        onChooseTemplate={onChooseTemplate}
        onHistory={onHistory}
      />
    </RequirePermissions>
  );
}
function DocumentGeneratorData({
  scope,
  documentType,
  initial,
  onChooseTemplate,
  onHistory,
}: {
  scope: DocumentScope;
  documentType: DocumentType;
  initial: DocumentInitialSelection;
  onChooseTemplate: () => void;
  onHistory: () => void;
}) {
  const template = useQuery(
    orpc.school.getActiveDocumentTemplate.queryOptions({
      input: { schoolId: scope.schoolId, documentType },
    }),
  );
  const classes = useQuery(
    orpc.school.listClasses.queryOptions({
      input: { schoolId: scope.schoolId },
    }),
  );
  if (template.isPending || classes.isPending) return <DocumentLoading />;
  if (template.isError)
    return (
      <DocumentReadError error={template.error} retry={template.refetch} />
    );
  if (classes.isError)
    return <DocumentReadError error={classes.error} retry={classes.refetch} />;
  if (!template.data)
    return (
      <DocumentPanel
        title="Choose a template to get started"
        description={`${DOCUMENT_LABELS[documentType]} need a selected school template before you can create a document.`}
      >
        <DocumentPermission
          schoolId={scope.schoolId}
          action={SCHOOL_ACTIONS.MANAGE_DOCUMENT_TEMPLATES}
          fallback={
            <DocumentNotice>
              Ask your school’s manager to select a template.
            </DocumentNotice>
          }
        >
          <DocumentButton onClick={onChooseTemplate}>
            Explore templates
            <ArrowRight />
          </DocumentButton>
        </DocumentPermission>
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
      classes={classes.data}
      onHistory={onHistory}
    />
  );
}
/** Holds preview/generation state in TanStack Form. A preview is valid only
 * for its explicit recipient/exam selection and immutable template revision.
 */
function useDocumentGeneration({
  scope,
  documentType,
  initial,
  template,
}: {
  scope: DocumentScope;
  documentType: DocumentType;
  initial: DocumentInitialSelection;
  template: { id: string; name: string };
}) {
  const cache = useDocumentCache();
  const schema = z
    .object({
      classId:
        documentType === 'timetable'
          ? z.string()
          : z.string().min(1, 'Choose a class'),
      examSlug:
        documentType === 'id_card'
          ? z.string()
          : z.string().min(1, 'Choose an examination'),
      audience: z.enum(['all', 'selected']),
      studentIds: z.array(z.string()).max(500),
      mode: z.enum(['preview', 'generate']),
      error: z.string(),
      preview: z.custom<Preview>().nullable(),
      generatedId: z.string(),
    })
    .superRefine((value, ctx) => {
      if (
        documentType !== 'timetable' &&
        value.audience === 'selected' &&
        value.studentIds.length === 0
      )
        ctx.addIssue({
          code: 'custom',
          path: ['studentIds'],
          message: 'Select at least one student',
        });
    });
  const sourceFor = (value: {
    classId: string;
    examSlug: string;
    audience: string;
    studentIds: string[];
  }): DocumentSource => {
    if (documentType === 'timetable')
      return {
        documentType,
        sessionId: scope.sessionId,
        examSlug: value.examSlug,
        ...(value.classId ? { classId: value.classId } : {}),
      };
    const selection = {
      sessionId: scope.sessionId,
      classId: value.classId,
      ...(value.audience === 'selected'
        ? { studentIds: value.studentIds }
        : {}),
    };
    return documentType === 'id_card'
      ? { documentType, ...selection }
      : { documentType, ...selection, examSlug: value.examSlug };
  };
  const form = useForm({
    defaultValues: {
      classId: initial.classId ?? '',
      examSlug: initial.examSlug ?? '',
      audience: initial.studentId ? 'selected' : 'all',
      studentIds: initial.studentId ? [initial.studentId] : ([] as string[]),
      mode: 'preview',
      error: '',
      preview: null as Preview | null,
      generatedId: '',
    },
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      form.setFieldValue('error', '');
      const source = sourceFor(value);
      try {
        if (value.mode === 'preview') {
          const preview = await client.school.previewDocument({
            schoolId: scope.schoolId,
            source,
            templateRevisionId: template.id,
          });
          form.setFieldValue('preview', {
            ...preview,
            fingerprint: JSON.stringify(source),
          });
          form.setFieldValue('generatedId', '');
        } else {
          if (value.preview?.fingerprint !== JSON.stringify(source)) {
            form.setFieldValue(
              'error',
              'Preview this selection before creating the PDF.',
            );
            return;
          }
          const result = await client.school.generateDocument({
            schoolId: scope.schoolId,
            source,
            templateRevisionId: template.id,
          });
          form.setFieldValue('generatedId', result.artifact.id);
          await cache.artifacts(scope.schoolId);
        }
      } catch (error) {
        form.setFieldValue(
          'error',
          error instanceof Error
            ? error.message
            : 'Unable to create this document.',
        );
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'CONFLICT'
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
  classes,
  onHistory,
}: {
  scope: DocumentScope;
  documentType: DocumentType;
  initial: DocumentInitialSelection;
  template: { id: string; name: string };
  classes: { id: string; label: string }[];
  onHistory: () => void;
}) {
  const { form, sourceFor } = useDocumentGeneration({
    scope,
    documentType,
    initial,
    template,
  });
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
      <DocumentPanel
        title="Create a document"
        description="Choose the data to include, check the preview, and create your PDF."
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
            form.setFieldValue('mode', 'preview');
            void form.handleSubmit();
          }}
        >
          <form.Field name="classId">
            {(field) => (
              <DocumentSelect
                field={{
                  name: field.name,
                  state: field.state,
                  handleBlur: field.handleBlur,
                  handleChange: (value) => {
                    field.handleChange(value);
                    form.setFieldValue('studentIds', []);
                  },
                }}
                label={documentType === 'timetable' ? 'Classes' : 'Class'}
              >
                <option value="">
                  {documentType === 'timetable'
                    ? 'All scheduled classes'
                    : 'Choose a class'}
                </option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </DocumentSelect>
            )}
          </form.Field>
          {documentType !== 'id_card' && (
            <form.Field name="examSlug">
              {(field) => <ExamSelector scope={scope} field={field} />}
            </form.Field>
          )}
          {documentType !== 'timetable' && (
            <>
              <form.Field name="audience">
                {(field) => (
                  <DocumentSelect field={field} label="Recipients">
                    <option value="all">
                      All registered students in this class
                    </option>
                    <option value="selected">Select students</option>
                  </DocumentSelect>
                )}
              </form.Field>
              <form.Subscribe
                selector={(state) => ({
                  audience: state.values.audience,
                  classId: state.values.classId,
                })}
              >
                {(values) =>
                  values.audience === 'selected' &&
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
          {documentType === 'report_card' && (
            <DocumentNotice>
              Report cards include approved results only. Every subject plan
              must be active or completed.
            </DocumentNotice>
          )}
          <GenerationActions
            form={form}
            sourceFor={sourceFor}
            scope={scope}
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
              label={
                values.preview
                  ? `Print preview${values.preview.studentCount ? ` · ${values.preview.studentCount} student${values.preview.studentCount === 1 ? '' : 's'}` : ''}`
                  : 'Print preview'
              }
            />
          </div>
        )}
      </form.Subscribe>
    </div>
  );
}
type GenerationFormApi = ReturnType<typeof useDocumentGeneration>['form'];
function GenerationActions({
  form,
  sourceFor,
  scope,
  onHistory,
}: {
  form: GenerationFormApi;
  sourceFor: ReturnType<typeof useDocumentGeneration>['sourceFor'];
  scope: DocumentScope;
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
          <DocumentButton
            type="submit"
            variant="outline"
            disabled={submitting || !canSubmit}
          >
            <Eye />
            {submitting && values.mode === 'preview'
              ? 'Preparing preview…'
              : 'Preview document'}
          </DocumentButton>
          <DocumentButton
            type="button"
            disabled={
              submitting ||
              !canSubmit ||
              values.preview?.fingerprint !== JSON.stringify(sourceFor(values))
            }
            onClick={() => {
              form.setFieldValue('mode', 'generate');
              void form.handleSubmit();
            }}
          >
            <FileDown />
            {submitting && values.mode === 'generate'
              ? 'Creating PDF…'
              : 'Create PDF'}
          </DocumentButton>
          {values.generatedId && (
            <GenerationSuccess
              schoolId={scope.schoolId}
              artifactId={values.generatedId}
              onHistory={onHistory}
            />
          )}
        </div>
      )}
    </form.Subscribe>
  );
}
function ExamSelector({
  scope,
  field,
}: {
  scope: DocumentScope;
  field: import('@campuspilot/components/documents/document-controls').DocumentStringField;
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
    <DocumentSelect field={field} label="Examination">
      <option value="">Choose an examination</option>
      {exams.map(([slug, exam]) => (
        <option key={slug} value={slug}>
          {exam.name}
        </option>
      ))}
    </DocumentSelect>
  );
}
function GenerationSuccess({
  schoolId,
  artifactId,
  onHistory,
}: {
  schoolId: string;
  artifactId: string;
  onHistory: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <p role="status" className="flex items-center gap-2 text-sm font-medium">
        <CheckCircle2 className="size-4" />
        Your PDF is ready
      </p>
      <DocumentPermission
        schoolId={schoolId}
        action={SCHOOL_ACTIONS.READ_DOCUMENT_ARTIFACTS}
      >
        <DocumentDownload schoolId={schoolId} artifactId={artifactId} />
        <DocumentButton type="button" variant="ghost" onClick={onHistory}>
          View document history
          <ArrowRight />
        </DocumentButton>
      </DocumentPermission>
    </div>
  );
}
/** Issue a fresh short-lived URL on each click, keeping expired URLs out of the
 * history cache. The navigation happens only after the authorization succeeds.
 */
export function DocumentDownload({
  schoolId,
  artifactId,
}: {
  schoolId: string;
  artifactId: string;
}) {
  const form = useForm({
    defaultValues: { error: '' },
    validators: { onChange: z.object({ error: z.string() }) },
    onSubmit: async () => {
      form.setFieldValue('error', '');
      try {
        const { url } = await client.school.getDocumentDownload({
          schoolId,
          artifactId,
        });
        const link = document.createElement('a');
        link.href = url;
        link.rel = 'noopener noreferrer';
        link.click();
      } catch (error) {
        form.setFieldValue(
          'error',
          error instanceof Error ? error.message : 'Download unavailable.',
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
            {submitting ? 'Preparing download…' : 'Download PDF'}
          </DocumentButton>
          {error && <DocumentNotice error>{error}</DocumentNotice>}
        </div>
      )}
    </form.Subscribe>
  );
}
