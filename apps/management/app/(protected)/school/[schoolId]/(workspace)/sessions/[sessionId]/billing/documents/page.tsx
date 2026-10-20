import { FinanceDocumentHistory } from '@/components/billing/finance-document-history';
import { FinanceDocumentBulkActions } from '@/components/billing/finance-document-bulk-actions';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import { RequirePermissions } from '@/components/require-permissions';

export default async function Page({ params }: { params: Promise<{ schoolId: string; sessionId: string }> }) {
  const { schoolId, sessionId } = await params;
  return <div className="flex flex-col gap-8"><RequirePermissions permissions={{ action: SCHOOL_ACTIONS.GENERATE_FINANCE_DOCUMENTS, resource: { kind: 'school', schoolId } }}><FinanceDocumentBulkActions schoolId={schoolId} sessionId={sessionId} /></RequirePermissions><FinanceDocumentHistory schoolId={schoolId} sessionId={sessionId} /></div>;
}
