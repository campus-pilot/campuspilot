'use client';

import { useForm } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { Button } from '@campuspilot/ui/components/button';
import { Input } from '@campuspilot/ui/components/input';
import { RequirePermissions } from '@/components/require-permissions';
import { orpc } from '@/lib/orpc';
import {
  FinanceDocumentAction,
  StatementDocumentDialog,
  type StatementSession,
} from './finance-document-action';
import { FinanceError, FinanceLoading, SimplePagination } from './finance-ui';

type Selection = { id: string; label: string };
const selectionSchema = z.object({ id: z.string().min(1), label: z.string().min(1) });

function SelectedItems({ label, values, onRemove }: { label: string; values: Selection[]; onRemove: (id: string) => void }) {
  if (!values.length) return <p className="text-xs text-muted-foreground">No {label.toLowerCase()} selected.</p>;
  return <div className="flex flex-wrap gap-2">{values.map((value) => <Button key={value.id} type="button" size="sm" variant="secondary" onClick={() => onRemove(value.id)}>{value.label}<span aria-hidden>×</span><span className="sr-only">Remove</span></Button>)}</div>;
}

function BulkReceiptSelection({ schoolId, sessionId }: { schoolId: string; sessionId: string }) {
  const form = useForm({ defaultValues: { search: '', page: 1, selected: [] as Selection[] }, validators: { onChange: z.object({ search: z.string().max(200), page: z.number().int().positive(), selected: z.array(selectionSchema).max(500) }) } });
  return <article className="flex flex-col gap-3 rounded-xl border p-4"><div><h3 className="font-medium">Bulk receipts</h3><p className="text-xs text-muted-foreground">Select up to 500 posted payments across pages and generate one immutable PDF.</p></div><form.Subscribe selector={(state) => state.values}>{(values) => <BulkReceiptRows schoolId={schoolId} sessionId={sessionId} values={values} onSearch={(search) => { form.setFieldValue('search', search); form.setFieldValue('page', 1); }} onPage={(page) => form.setFieldValue('page', page)} onSelected={(selected) => form.setFieldValue('selected', selected)} />}</form.Subscribe></article>;
}

function BulkReceiptRows({ schoolId, sessionId, values, onSearch, onPage, onSelected }: { schoolId: string; sessionId: string; values: { search: string; page: number; selected: Selection[] }; onSearch: (value: string) => void; onPage: (value: number) => void; onSelected: (value: Selection[]) => void }) {
  const query = useQuery(orpc.school.listPayments.queryOptions({ input: { schoolId, filters: { sessionId, search: values.search || undefined }, page: values.page, limit: 20, orderBy: { field: 'receivedAt', direction: 'desc' } } }));
  if (query.isPending) return <FinanceLoading />;
  if (query.isError) return <FinanceError title="Unable to load payments" error={query.error} />;
  const selectedIds = new Set(values.selected.map(({ id }) => id));
  return <div className="flex flex-col gap-3"><Input value={values.search} placeholder="Search receipts or admissions…" aria-label="Search payments for bulk receipts" onChange={(event) => onSearch(event.target.value)} /><SelectedItems label="Payments" values={values.selected} onRemove={(id) => onSelected(values.selected.filter((item) => item.id !== id))} /><div className="flex flex-col gap-1">{query.data.items.map((payment) => { const selected = selectedIds.has(payment.id); const disabled = payment.reversed || (!selected && values.selected.length >= 500); return <Button key={payment.id} type="button" size="sm" variant={selected ? 'secondary' : 'ghost'} className="justify-between" disabled={disabled} onClick={() => onSelected(selected ? values.selected.filter(({ id }) => id !== payment.id) : [...values.selected, { id: payment.id, label: `${payment.receiptNumber} · ${payment.admissionName}` }])}><span className="truncate">{payment.receiptNumber} · {payment.admissionName}</span><span>{payment.reversed ? 'Reversed' : selected ? 'Selected' : 'Add'}</span></Button>; })}</div><SimplePagination currentPage={query.data.pagination.currentPage} totalPages={query.data.pagination.totalPages} onPageChange={onPage} />{values.selected.length ? <FinanceDocumentAction schoolId={schoolId} source={{ documentType: 'receipt', sessionId, transactions: values.selected.map(({ id }) => ({ kind: 'payment' as const, id })) }} label={`Generate ${values.selected.length} receipts`} /> : null}</div>;
}

function BulkStatementSelection({ schoolId, sessionId }: { schoolId: string; sessionId: string }) {
  const resource = { kind: 'school' as const, schoolId };
  return <RequirePermissions permissions={[
    { action: SCHOOL_ACTIONS.GENERATE_FINANCE_DOCUMENTS, resource },
    { action: SCHOOL_ACTIONS.READ_FINANCE_DOCUMENT_TEMPLATES, resource },
    { action: SCHOOL_ACTIONS.READ_SESSION_FINANCE, resource },
    { action: SCHOOL_ACTIONS.READ_ADMISSION_LEDGER, resource },
    { action: SCHOOL_ACTIONS.READ_SESSION, resource },
    { action: SCHOOL_ACTIONS.LIST_ADMISSIONS, resource },
  ]}><BulkStatementSelectionInner schoolId={schoolId} sessionId={sessionId} /></RequirePermissions>;
}

/** Session dates and finance readiness are loaded independently so a
 * statement-ready state never has to be inferred from correlated fields. */
function BulkStatementSelectionInner({ schoolId, sessionId }: { schoolId: string; sessionId: string }) {
  const finance = useQuery(orpc.school.getSessionFinance.queryOptions({ input: { schoolId, sessionId } }));
  const session = useQuery(orpc.school.getSession.queryOptions({ input: { schoolId, sessionId } }));
  const form = useForm({ defaultValues: { search: '', page: 1, selected: [] as Selection[], dialogOpen: false }, validators: { onChange: z.object({ search: z.string().max(200), page: z.number().int().positive(), selected: z.array(selectionSchema).max(500), dialogOpen: z.boolean() }) } });
  if (finance.isPending || session.isPending) return <FinanceLoading />;
  if (finance.isError) return <FinanceError title="Unable to load session finance" error={finance.error} />;
  if (session.isError) return <FinanceError title="Unable to load session" error={session.error} />;
  const config = finance.data.financeConfig;
  const statementSession: StatementSession = finance.data.configurationReadiness.readyForBilling && config?.currency && config.timeZone && config.cycleStartMonth
    ? {
        id: sessionId,
        label: `${session.data.sessionStartYear}–${session.data.sessionEndYear}`,
        status: 'ready',
        currency: config.currency,
        timeZone: config.timeZone,
        startYear: session.data.sessionStartYear,
        endYear: session.data.sessionEndYear,
        cycleStartMonth: config.cycleStartMonth,
      }
    : {
        id: sessionId,
        label: `${session.data.sessionStartYear}–${session.data.sessionEndYear}`,
        status: 'incomplete',
        missingFields: finance.data.configurationReadiness.missingFields,
      };
  return <article className="flex flex-col gap-3 rounded-xl border p-4"><div><h3 className="font-medium">Bulk statements</h3><p className="text-xs text-muted-foreground">Select up to 500 admission accounts across pages, then review one local-date cutoff for the immutable PDF.</p></div><form.Subscribe selector={(state) => state.values}>{(values) => <BulkStatementRows schoolId={schoolId} sessionId={sessionId} statementSession={statementSession} values={values} onSearch={(search) => { form.setFieldValue('search', search); form.setFieldValue('page', 1); }} onPage={(page) => form.setFieldValue('page', page)} onSelected={(selected) => form.setFieldValue('selected', selected)} onDialog={(open) => form.setFieldValue('dialogOpen', open)} />}</form.Subscribe></article>;
}

function BulkStatementRows({ schoolId, sessionId, statementSession, values, onSearch, onPage, onSelected, onDialog }: { schoolId: string; sessionId: string; statementSession: StatementSession; values: { search: string; page: number; selected: Selection[]; dialogOpen: boolean }; onSearch: (value: string) => void; onPage: (value: number) => void; onSelected: (value: Selection[]) => void; onDialog: (open: boolean) => void }) {
  const query = useQuery(orpc.school.listAdmissions.queryOptions({ input: { schoolId, searchQuery: values.search || undefined, page: values.page, limit: 20, orderBy: { field: 'name', direction: 'asc' } } }));
  if (query.isPending) return <FinanceLoading />;
  if (query.isError) return <FinanceError title="Unable to load admission accounts" error={query.error} />;
  const selectedIds = new Set(values.selected.map(({ id }) => id));
  const configured = statementSession.status === 'ready';
  return <div className="flex flex-col gap-3"><Input value={values.search} placeholder="Search name or admission number…" aria-label="Search admissions for bulk statements" onChange={(event) => onSearch(event.target.value)} /><SelectedItems label="Admissions" values={values.selected} onRemove={(id) => onSelected(values.selected.filter((item) => item.id !== id))} /><div className="flex flex-col gap-1">{query.data.items.map((admission) => { const selected = selectedIds.has(admission.id); return <Button key={admission.id} type="button" size="sm" variant={selected ? 'secondary' : 'ghost'} className="justify-between" disabled={!selected && values.selected.length >= 500} onClick={() => onSelected(selected ? values.selected.filter(({ id }) => id !== admission.id) : [...values.selected, { id: admission.id, label: `${admission.name} · ${admission.admissionNo}` }])}><span className="truncate">{admission.name} · {admission.admissionNo}</span><span>{selected ? 'Selected' : 'Add'}</span></Button>; })}</div><SimplePagination currentPage={query.data.pagination.currentPage} totalPages={query.data.pagination.totalPages} onPageChange={onPage} />{!configured ? <p className="text-xs text-muted-foreground">Complete the session currency, finance time zone, and billing cycle setup before generating statements.</p> : null}<Button type="button" variant="outline" disabled={!values.selected.length || !configured} onClick={() => onDialog(true)}>Generate {values.selected.length || ''} statement{values.selected.length === 1 ? '' : 's'}</Button>{values.dialogOpen && configured ? <StatementDocumentDialog schoolId={schoolId} admissionIds={values.selected.map(({ id }) => id)} sessions={[statementSession]} defaultSessionId={sessionId} onClose={() => onDialog(false)} /> : null}</div>;
}

export function FinanceDocumentBulkActions({ schoolId, sessionId }: { schoolId: string; sessionId: string }) {
  return <section className="flex flex-col gap-3"><div><h2 className="text-lg font-semibold">Bulk generation</h2><p className="text-xs text-muted-foreground">Selections persist across search pages and are capped by the 500-source API contract.</p></div><div className="grid gap-4 xl:grid-cols-2"><BulkReceiptSelection schoolId={schoolId} sessionId={sessionId} /><BulkStatementSelection schoolId={schoolId} sessionId={sessionId} /></div></section>;
}
