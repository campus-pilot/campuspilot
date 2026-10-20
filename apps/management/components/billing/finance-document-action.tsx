'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { Download, FileText } from 'lucide-react';
import type { DocumentSource } from '@campuspilot/api/routers/school/document/document.dto';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { Button } from '@campuspilot/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@campuspilot/ui/components/dialog';
import { Input } from '@campuspilot/ui/components/input';
import { Label } from '@campuspilot/ui/components/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@campuspilot/ui/components/select';
import { RequirePermissions } from '@/components/require-permissions';
import { client, orpc } from '@/lib/orpc';

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

type StatementSession = { id: string; label: string; currency: string; timeZone: string };

/** Returns today's calendar date in the selected finance time zone. Statement
 * cutoffs are local-date contracts and must not inherit the browser/UTC date. */
function currentDateInTimeZone(timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

/** Statement generation always previews first and binds generation to the
 * reviewed per-account/currency high-water marks returned by the server. */
export function StatementDocumentDialog({ schoolId, admissionIds, sessions, defaultSessionId, onClose }: { schoolId: string; admissionIds: string[]; sessions: StatementSession[]; defaultSessionId: string; onClose: () => void }) {
  const template = useQuery(orpc.school.getActiveDocumentTemplate.queryOptions({ input: { schoolId, documentType: 'statement' } }));
  const mutation = useMutation({ mutationFn: async (values: { sessionId: string; throughDate: string }) => {
    const session = sessions.find((item) => item.id === values.sessionId);
    if (!session || !template.data) throw new Error('Configure a statement template and session finance before generating.');
    const base = { documentType: 'statement' as const, sessionId: session.id, admissionIds, throughDate: values.throughDate };
    const preview = await client.school.previewDocument({ schoolId, source: base, templateRevisionId: template.data.artifact.id });
    if (!preview.reviewHash) throw new Error('Statement preview did not return a review hash.');
    const generated = await client.school.generateDocument({ schoolId, source: { ...base, expectedReviewHash: preview.reviewHash }, templateRevisionId: template.data.artifact.id });
    return client.school.getDocumentDownload({ schoolId, artifactId: generated.artifact.id, documentType: 'statement' });
  }, onSuccess: ({ url }) => { window.open(url, '_blank', 'noopener,noreferrer'); onClose(); } });
  const defaultTimeZone = sessions.find((session) => session.id === defaultSessionId)?.timeZone ?? 'Asia/Kolkata';
  const form = useForm({ defaultValues: { sessionId: defaultSessionId, throughDate: currentDateInTimeZone(defaultTimeZone) }, validators: { onChange: z.object({ sessionId: z.string().min(1, 'Choose a session.'), throughDate: z.string().date('Choose a valid statement date.') }) }, onSubmit: ({ value }) => mutation.mutateAsync(value) });
  return <Dialog open onOpenChange={(open) => !open && onClose()}><DialogContent><DialogHeader><DialogTitle>Generate account statement</DialogTitle><DialogDescription>The PDF is pinned to ledger facts through the selected local date.</DialogDescription></DialogHeader><form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void form.handleSubmit(); }}><form.Field name="sessionId">{(field) => <div className="flex flex-col gap-1.5"><Label htmlFor="statement-session">Session</Label><Select value={field.state.value} onValueChange={field.handleChange}><SelectTrigger id="statement-session" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{sessions.map((session) => <SelectItem key={session.id} value={session.id}>{session.label}</SelectItem>)}</SelectContent></Select>{field.state.meta.errors.map((error) => <p key={String(error)} className="text-xs text-destructive">{typeof error === 'object' && error && 'message' in error ? String(error.message) : String(error)}</p>)}</div>}</form.Field><form.Field name="throughDate">{(field) => <div className="flex flex-col gap-1.5"><Label htmlFor="statement-through">Through date</Label><Input id="statement-through" type="date" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} />{field.state.meta.errors.map((error) => <p key={String(error)} className="text-xs text-destructive">{typeof error === 'object' && error && 'message' in error ? String(error.message) : String(error)}</p>)}</div>}</form.Field>{mutation.error ? <p className="text-sm text-destructive">{mutation.error.message}</p> : null}<DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, submitting: state.isSubmitting })}>{({ canSubmit, submitting }) => <Button type="submit" disabled={!canSubmit || submitting || !template.data}>{submitting ? 'Generating…' : 'Generate statement'}</Button>}</form.Subscribe></DialogFooter></form></DialogContent></Dialog>;
}
