'use client';

import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, RefreshCw, Trash2 } from 'lucide-react';
import { z } from 'zod';
import type { DocumentArtifact } from '@campuspilot/api/routers/school/document/document.dto';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { ConfirmationDialog } from '@campuspilot/components/confirmation-dialog';
import { TableSearchBar } from '@campuspilot/components/data-grid';
import { Badge } from '@campuspilot/ui/components/badge';
import { Button } from '@campuspilot/ui/components/button';
import { RequirePermissions } from '@/components/require-permissions';
import { client, orpc } from '@/lib/orpc';
import { FinanceError, FinanceLoading, SimplePagination } from './finance-ui';

export function FinanceDocumentHistory({ schoolId, sessionId }: { schoolId: string; sessionId: string }) {
  const form = useForm({ defaultValues: { search: '', page: 1 }, validators: { onChange: z.object({ search: z.string().max(100), page: z.number().int().positive() }) } });
  return <section className="flex min-w-0 flex-col gap-4"><header><h2 className="text-lg font-semibold">Finance document history</h2><p className="text-xs text-muted-foreground">Immutable PDFs retain their template revision and posted source snapshot. Downloads always use a fresh short-lived URL.</p></header><form.Field name="search">{(field) => <TableSearchBar placeholder="Search finance documents…" onSearchChange={(value) => { field.handleChange(value ?? ''); form.setFieldValue('page', 1); }} />}</form.Field><form.Subscribe selector={(state) => state.values}>{({ search, page }) => <FinanceHistoryRows schoolId={schoolId} sessionId={sessionId} search={search} page={page} onPage={(next) => form.setFieldValue('page', next)} />}</form.Subscribe></section>;
}

function FinanceHistoryRows({ schoolId, sessionId, search, page, onPage }: { schoolId: string; sessionId: string; search: string; page: number; onPage: (page: number) => void }) {
  const history = useQuery(orpc.school.listDocumentArtifacts.queryOptions({ input: { schoolId, filters: { sessionId, documentDomain: 'finance' }, searchQuery: search, page, limit: 25 } }));
  const finance = useQuery(orpc.school.getSessionFinance.queryOptions({ input: { schoolId, sessionId } }));
  if (history.isPending || finance.isPending) return <FinanceLoading />;
  if (history.isError || finance.isError) return <FinanceError title="Unable to load finance documents" error={history.error ?? finance.error} />;
  const timeZone = finance.data.financeConfig?.timeZone ?? null;
  return <div className="flex min-w-0 flex-col gap-3">{history.data.items.length ? <div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[720px] text-sm"><thead className="bg-muted/40"><tr><th className="p-3 text-left">Document</th><th className="p-3 text-left">Type</th><th className="p-3 text-left">Template</th><th className="p-3 text-left">Status</th><th className="p-3 text-right">Actions</th></tr></thead><tbody>{history.data.items.map((artifact) => <ArtifactRow key={artifact.id} artifact={artifact} timeZone={timeZone} />)}</tbody></table></div> : <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{search ? 'No finance PDFs match your search.' : 'No finance PDFs have been generated for this session.'}</p>}<div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{history.data.pagination.totalItems} documents · Page {page} of {Math.max(1, history.data.pagination.totalPages)}</p><SimplePagination currentPage={page} totalPages={history.data.pagination.totalPages} onPageChange={onPage} /></div></div>;
}

function ArtifactRow({ artifact, timeZone }: { artifact: DocumentArtifact; timeZone: string | null }) {
  const cache = useQueryClient();
  const download = useMutation({ mutationFn: () => client.school.getDocumentDownload({ schoolId: artifact.schoolId, artifactId: artifact.id, documentType: artifact.documentType }), onSuccess: ({ url }) => window.open(url, '_blank', 'noopener,noreferrer') });
  const deletion = useForm({ defaultValues: { confirming: false, error: '' }, validators: { onChange: z.object({ confirming: z.boolean(), error: z.string() }) }, onSubmit: async () => { deletion.setFieldValue('error', ''); try { await client.school.deleteDocumentArtifact({ schoolId: artifact.schoolId, artifactId: artifact.id, documentType: artifact.documentType }); deletion.setFieldValue('confirming', false); await cache.invalidateQueries({ queryKey: orpc.school.listDocumentArtifacts.key() }); } catch (error) { deletion.setFieldValue('error', error instanceof Error ? error.message : 'Document deletion failed.'); await cache.invalidateQueries({ queryKey: orpc.school.listDocumentArtifacts.key() }); } } });
  const resource = { kind: 'school' as const, schoolId: artifact.schoolId };
  const createdLabel = timeZone ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(artifact.createdAt)) : `${artifact.createdAt} · finance time zone unavailable`;
  return <tr className="border-t"><td className="p-3"><p className="font-medium">{artifact.name}</p><p className="text-xs text-muted-foreground">{createdLabel}</p></td><td className="p-3 capitalize">{artifact.documentType.replaceAll('_', ' ')}</td><td className="p-3">{artifact.templateName ?? artifact.templateRevisionId ?? 'Unknown revision'}</td><td className="p-3"><Badge variant={artifact.status === 'ready' ? 'secondary' : 'destructive'}>{artifact.status}</Badge></td><td className="p-3"><div className="flex justify-end gap-2"><Button type="button" size="sm" variant="outline" disabled={artifact.status !== 'ready' || download.isPending} onClick={() => download.mutate()}><Download aria-hidden />Download</Button><RequirePermissions permissions={{ action: SCHOOL_ACTIONS.DELETE_FINANCE_DOCUMENT_ARTIFACTS, resource }}><deletion.Subscribe selector={(state) => ({ confirming: state.values.confirming, error: state.values.error, pending: state.isSubmitting, canSubmit: state.canSubmit })}>{({ confirming, error, pending, canSubmit }) => <div className="flex flex-col items-end gap-1"><Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => deletion.setFieldValue('confirming', true)}>{artifact.status === 'deleting' ? <RefreshCw aria-hidden /> : <Trash2 aria-hidden />}{artifact.status === 'deleting' ? 'Retry deletion' : 'Delete'}</Button><ConfirmationDialog open={confirming} title={artifact.status === 'deleting' ? 'Retry document deletion?' : 'Delete this finance document?'} description="The immutable PDF will be removed from storage and history. This action cannot be undone." confirmLabel={pending ? 'Deleting…' : artifact.status === 'deleting' ? 'Retry deletion' : 'Delete document'} pending={pending} onOpenChange={(open) => deletion.setFieldValue('confirming', open)} onConfirm={() => { if (canSubmit) void deletion.handleSubmit(); }} />{error ? <p className="text-right text-xs text-destructive">{error}</p> : null}</div>}</deletion.Subscribe></RequirePermissions></div>{download.error ? <p className="mt-1 text-right text-xs text-destructive">{download.error instanceof Error ? download.error.message : 'Document download failed.'}</p> : null}</td></tr>;
}
