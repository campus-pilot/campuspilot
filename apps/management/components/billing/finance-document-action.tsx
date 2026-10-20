'use client';

import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import { CheckCircle2, CircleAlert, Download, FileText, LoaderCircle, RefreshCw, Settings } from 'lucide-react';
import type { DocumentSource } from '@campuspilot/api/routers/school/document/document.dto';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import {
  createStatementFormSchema,
  getStatementDateBounds,
  isReadyStatementSession,
  type StatementSession,
} from '@campuspilot/components/documents/statement-session';
import { Alert, AlertDescription, AlertTitle } from '@campuspilot/ui/components/alert';
import { Button } from '@campuspilot/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@campuspilot/ui/components/dialog';
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@campuspilot/ui/components/select';
import { RequirePermissions } from '@/components/require-permissions';
import { schoolHref } from '@/components/school-route';
import { client, orpc } from '@/lib/orpc';
import { DocumentDownload } from '@/components/documents/document-generator';

export type { StatementSession } from '@campuspilot/components/documents/statement-session';

type FinanceSource = Extract<DocumentSource, { documentType: 'bill' | 'receipt' }>;

/** Generates an immutable PDF, then obtains a fresh short-lived signed URL.
 * The client never stores an S3 key or a durable download URL. */
export function FinanceDocumentAction({ schoolId, source, label }: { schoolId: string; source: FinanceSource; label: string }) {
  return <RequirePermissions permissions={{ action: SCHOOL_ACTIONS.GENERATE_FINANCE_DOCUMENTS, resource: { kind: 'school', schoolId } }}><FinanceDocumentActionInner schoolId={schoolId} source={source} label={label} /></RequirePermissions>;
}

function FinanceDocumentActionInner({ schoolId, source, label }: { schoolId: string; source: FinanceSource; label: string }) {
  const template = useQuery(orpc.school.getActiveDocumentTemplate.queryOptions({ input: { schoolId, documentType: source.documentType } }));
  const mutation = useMutation({
    mutationFn: async () => {
      if (!template.data) throw new Error(`Configure the ${source.documentType} template before generating a PDF.`);
      const generated = await client.school.generateDocument({ schoolId, source, templateRevisionId: template.data.artifact.id });
      return client.school.getDocumentDownload({ schoolId, artifactId: generated.artifact.id, documentType: source.documentType });
    },
    onSuccess: ({ url }) => window.open(url, '_blank', 'noopener,noreferrer'),
  });
  const error = template.error ?? mutation.error;
  return <div className="flex flex-col items-start gap-1"><Button type="button" variant="outline" disabled={template.isPending || mutation.isPending || !template.data} onClick={() => mutation.mutate()}>{mutation.isPending ? <FileText aria-hidden /> : <Download aria-hidden />}{mutation.isPending ? 'Generating…' : label}</Button>{!template.isPending && !template.data ? <p className="text-xs text-muted-foreground">Configure this template in Settings first.</p> : null}{error ? <p className="text-xs text-destructive">{error instanceof Error ? error.message : 'Unable to generate the document.'}</p> : null}</div>;
}

function sessionStatusLabel(session: StatementSession) {
  if (session.status === 'checking') return `${session.label} (checking finance settings)`;
  if (session.status === 'error') return `${session.label} (finance settings unavailable)`;
  if (session.status === 'incomplete') return `${session.label} (finance setup required)`;
  return session.label;
}

function humanizeMissingFinanceFields(fields: string[]) {
  const labels: Record<string, string> = {
    currency: 'currency',
    timeZone: 'finance time zone',
    cycleStartMonth: 'billing cycle start month',
  };
  return fields.map((field) => labels[field] ?? field).join(', ');
}

function StatementSessionRequirement({ schoolId, session }: { schoolId: string; session?: StatementSession }) {
  const resource = { kind: 'school' as const, schoolId };
  if (!session) {
    return (
      <Alert>
        <CircleAlert aria-hidden />
        <AlertTitle>No academic session is available</AlertTitle>
        <AlertDescription>Create an academic session before generating a statement.</AlertDescription>
      </Alert>
    );
  }
  if (session.status === 'checking') {
    return (
      <Alert>
        <LoaderCircle className="animate-spin" aria-hidden />
        <AlertTitle>Checking finance settings</AlertTitle>
        <AlertDescription>Statement generation will be available after this session's finance setup is checked.</AlertDescription>
      </Alert>
    );
  }
  if (session.status === 'error') {
    return (
      <Alert variant="destructive">
        <CircleAlert aria-hidden />
        <AlertTitle>Finance settings could not be loaded</AlertTitle>
        <AlertDescription>{session.error instanceof Error ? session.error.message : 'Try loading the session finance settings again.'}</AlertDescription>
        <div className="col-start-2 mt-1">
          <Button type="button" size="sm" variant="outline" disabled={session.retrying} onClick={() => void session.retry()}>
            <RefreshCw className={session.retrying ? 'animate-spin' : undefined} aria-hidden />
            Retry
          </Button>
        </div>
      </Alert>
    );
  }
  if (session.status === 'incomplete') {
    const missing = humanizeMissingFinanceFields(session.missingFields);
    return (
      <Alert>
        <CircleAlert aria-hidden />
        <AlertTitle>Complete this session's finance setup</AlertTitle>
        <AlertDescription>{missing ? `Add ${missing} before generating a statement.` : 'Complete all required finance settings before generating a statement.'}</AlertDescription>
        <RequirePermissions
          permissions={[
            { action: SCHOOL_ACTIONS.READ_SESSION, resource },
            { action: SCHOOL_ACTIONS.READ_SESSION_FINANCE, resource },
            { action: SCHOOL_ACTIONS.UPDATE_SESSION_FINANCE, resource },
          ]}
        >
          <div className="col-start-2 mt-1">
            <Button type="button" size="sm" variant="outline" asChild>
              <Link href={schoolHref(schoolId, `/settings/session/${encodeURIComponent(session.id)}`)}>
                <Settings aria-hidden />
                Finance settings
              </Link>
            </Button>
          </div>
        </RequirePermissions>
      </Alert>
    );
  }
  return null;
}

function StatementTemplateRequirement({ schoolId, pending, fetching, available, error, retry }: { schoolId: string; pending: boolean; fetching: boolean; available: boolean; error: unknown; retry: () => unknown }) {
  const resource = { kind: 'school' as const, schoolId };
  if (pending) {
    return (
      <Alert>
        <LoaderCircle className="animate-spin" aria-hidden />
        <AlertTitle>Checking the statement template</AlertTitle>
        <AlertDescription>Generation will be available after the active template is checked.</AlertDescription>
      </Alert>
    );
  }
  if (error) {
    return (
      <Alert variant="destructive">
        <CircleAlert aria-hidden />
        <AlertTitle>Statement template could not be loaded</AlertTitle>
        <AlertDescription>{error instanceof Error ? error.message : 'Try loading the active statement template again.'}</AlertDescription>
        <div className="col-start-2 mt-1">
          <Button type="button" size="sm" variant="outline" disabled={fetching} onClick={() => void retry()}>
            <RefreshCw className={fetching ? 'animate-spin' : undefined} aria-hidden />
            Retry
          </Button>
        </div>
      </Alert>
    );
  }
  if (!available) {
    return (
      <Alert>
        <CircleAlert aria-hidden />
        <AlertTitle>No active statement template</AlertTitle>
        <AlertDescription>Select a statement template in Settings before generating this document.</AlertDescription>
        <RequirePermissions
          permissions={[
            {
              action: SCHOOL_ACTIONS.READ_FINANCE_DOCUMENT_TEMPLATES,
              resource,
            },
            {
              action: SCHOOL_ACTIONS.MANAGE_FINANCE_DOCUMENT_TEMPLATES,
              resource,
            },
          ]}
        >
          <div className="col-start-2 mt-1">
            <Button type="button" size="sm" variant="outline" asChild>
              <Link href={schoolHref(schoolId, '/settings/templates/statement')}>
                <Settings aria-hidden />
                Statement template
              </Link>
            </Button>
          </div>
        </RequirePermissions>
      </Alert>
    );
  }
  return null;
}

type StatementDocumentDialogProps = {
  schoolId: string;
  admissionIds: string[];
  sessions: StatementSession[];
  defaultSessionId: string;
  onClose: () => void;
};

/** Permission checks wrap the query-owning component so protected template
 * reads never mount before all independent statement permissions pass. */
export function StatementDocumentDialog(props: StatementDocumentDialogProps) {
  const resource = { kind: 'school' as const, schoolId: props.schoolId };
  return (
    <RequirePermissions
      permissions={[
        { action: SCHOOL_ACTIONS.GENERATE_FINANCE_DOCUMENTS, resource },
        {
          action: SCHOOL_ACTIONS.READ_FINANCE_DOCUMENT_TEMPLATES,
          resource,
        },
        { action: SCHOOL_ACTIONS.READ_SESSION_FINANCE, resource },
        { action: SCHOOL_ACTIONS.READ_ADMISSION_LEDGER, resource },
      ]}
    >
      <StatementDocumentDialogInner {...props} />
    </RequirePermissions>
  );
}

/** Statement generation always previews first and binds generation to the
 * reviewed per-account/currency high-water marks returned by the server. */
function StatementDocumentDialogInner({
  schoolId,
  admissionIds,
  sessions,
  defaultSessionId,
  onClose,
}: StatementDocumentDialogProps) {
  const template = useQuery(
    orpc.school.getActiveDocumentTemplate.queryOptions({
      input: { schoolId, documentType: 'statement' },
    }),
  );
  const mutation = useMutation({
    mutationFn: async (values: { sessionId: string; throughDate: string }) => {
      const session = sessions.find((item) => item.id === values.sessionId);
      if (!isReadyStatementSession(session)) {
        throw new Error(
          "Complete this session's finance settings before generating a statement.",
        );
      }
      if (!template.data) {
        throw new Error(
          'Select an active statement template before generating a statement.',
        );
      }
      const base = {
        documentType: 'statement' as const,
        sessionId: session.id,
        admissionIds,
        throughDate: values.throughDate,
      };
      const preview = await client.school.previewDocument({
        schoolId,
        source: base,
        templateRevisionId: template.data.artifact.id,
      });
      if (!preview.reviewHash) {
        throw new Error('Statement preview did not return a review hash.');
      }
      const generated = await client.school.generateDocument({
        schoolId,
        source: { ...base, expectedReviewHash: preview.reviewHash },
        templateRevisionId: template.data.artifact.id,
      });
      return generated.artifact;
    },
  });
  const defaultSession =
    sessions.find((session) => session.id === defaultSessionId) ?? sessions[0];
  const defaultBounds = isReadyStatementSession(defaultSession)
    ? getStatementDateBounds(defaultSession)
    : undefined;
  const form = useForm({
    defaultValues: {
      sessionId: defaultSession?.id ?? '',
      throughDate: defaultBounds?.defaultDate ?? '',
    },
    validators: {
      onChange: createStatementFormSchema(sessions),
    },
    onSubmit: ({ value }) => mutation.mutateAsync(value),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate account statement</DialogTitle>
          <DialogDescription>
            The PDF is pinned to ledger facts through the selected local date. A
            secure preview is checked immediately before the immutable document
            is created.
          </DialogDescription>
        </DialogHeader>
        {mutation.data ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
              <p role="status" className="flex items-center gap-2 text-sm font-medium">
                <CheckCircle2 className="size-4" aria-hidden />
                Your statement PDF is ready
              </p>
              <RequirePermissions
                permissions={{
                  action: SCHOOL_ACTIONS.READ_FINANCE_DOCUMENT_ARTIFACTS,
                  resource: { kind: 'school', schoolId },
                }}
                fallback={
                  <p className="text-xs text-muted-foreground">
                    You do not have permission to download finance documents.
                  </p>
                }
              >
                <DocumentDownload
                  schoolId={schoolId}
                  artifactId={mutation.data.id}
                  documentType="statement"
                />
              </RequirePermissions>
            </div>
            <DialogFooter>
              <Button type="button" onClick={onClose}>
                Close
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void form.handleSubmit();
            }}
          >
          <form.Field name="sessionId">
            {(field) => (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="statement-session">Session</Label>
                <Select
                  value={field.state.value}
                  onValueChange={(value) => {
                    field.handleChange(value);
                    mutation.reset();
                    const nextSession = sessions.find(
                      (session) => session.id === value,
                    );
                    const nextBounds = isReadyStatementSession(nextSession)
                      ? getStatementDateBounds(nextSession)
                      : undefined;
                    form.setFieldValue(
                      'throughDate',
                      nextBounds?.defaultDate ?? '',
                    );
                  }}
                >
                  <SelectTrigger id="statement-session" className="w-full">
                    <SelectValue placeholder="Choose a session" />
                  </SelectTrigger>
                  <SelectContent>
                    {sessions.map((session) => (
                      <SelectItem key={session.id} value={session.id}>
                        {sessionStatusLabel(session)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {field.state.meta.errors.map((error) => (
                  <p
                    key={String(error)}
                    className="text-xs text-destructive"
                  >
                    {typeof error === 'object' && error && 'message' in error
                      ? String(error.message)
                      : String(error)}
                  </p>
                ))}
              </div>
            )}
          </form.Field>
          <form.Subscribe selector={(state) => state.values.sessionId}>
            {(sessionId) => {
              const session = sessions.find((item) => item.id === sessionId);
              const bounds = isReadyStatementSession(session)
                ? getStatementDateBounds(session)
                : undefined;
              return (
                <form.Field name="throughDate">
                  {(field) => (
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="statement-through">Through date</Label>
                      <Input
                        id="statement-through"
                        type="date"
                        min={bounds?.minDate}
                        max={bounds?.maxDate}
                        disabled={!bounds?.hasValidDate}
                        value={field.state.value}
                        onChange={(event) => {
                          field.handleChange(event.target.value);
                          mutation.reset();
                        }}
                      />
                      {bounds ? (
                        <p className="text-xs text-muted-foreground">
                          {bounds.hasValidDate
                            ? `Available from ${bounds.minDate} through ${bounds.maxDate}.`
                            : `Statements become available on ${bounds.minDate}.`}
                        </p>
                      ) : null}
                      {field.state.meta.errors.map((error) => (
                        <p
                          key={String(error)}
                          className="text-xs text-destructive"
                        >
                          {typeof error === 'object' &&
                          error &&
                          'message' in error
                            ? String(error.message)
                            : String(error)}
                        </p>
                      ))}
                    </div>
                  )}
                </form.Field>
              );
            }}
          </form.Subscribe>
          <StatementTemplateRequirement
            schoolId={schoolId}
            pending={template.isPending}
            fetching={template.isFetching}
            available={Boolean(template.data)}
            error={template.error}
            retry={() => template.refetch()}
          />
          <form.Subscribe selector={(state) => state.values.sessionId}>
            {(sessionId) => (
              <StatementSessionRequirement
                schoolId={schoolId}
                session={sessions.find((session) => session.id === sessionId)}
              />
            )}
          </form.Subscribe>
          {mutation.error ? (
            <p className="text-sm text-destructive">
              {mutation.error.message}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <form.Subscribe
              selector={(state) => ({
                canSubmit: state.canSubmit,
                submitting: state.isSubmitting,
                sessionId: state.values.sessionId,
                throughDate: state.values.throughDate,
              })}
            >
              {({ canSubmit, submitting, sessionId, throughDate }) => {
                const session = sessions.find(
                  (item) => item.id === sessionId,
                );
                const bounds = isReadyStatementSession(session)
                  ? getStatementDateBounds(session)
                  : undefined;
                const dateIsWithinBounds = Boolean(
                  bounds?.hasValidDate &&
                    throughDate >= bounds.minDate &&
                    throughDate <= bounds.maxDate,
                );
                return (
                  <Button
                    type="submit"
                    disabled={
                      !canSubmit ||
                      submitting ||
                      template.isPending ||
                      template.isError ||
                      !template.data ||
                      !isReadyStatementSession(session) ||
                      !dateIsWithinBounds
                    }
                  >
                    {submitting ? 'Generating…' : 'Generate statement'}
                  </Button>
                );
              }}
            </form.Subscribe>
          </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
