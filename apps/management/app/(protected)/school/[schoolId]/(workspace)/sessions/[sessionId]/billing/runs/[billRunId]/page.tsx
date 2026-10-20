import { SCHOOL_ACTIONS } from "@campuspilot/api/routers/authorization/authorization.dto";
import { BillingRunDetail } from "@/components/billing/billing-run-detail";
import { RequirePermissions } from "@/components/require-permissions";
export default async function Page({ params }: { params: Promise<{ schoolId: string; sessionId: string; billRunId: string }> }) { const { schoolId, sessionId, billRunId } = await params; return <RequirePermissions permissions={{ action: SCHOOL_ACTIONS.READ_BILLING_RUNS, resource: { kind: "school", schoolId } }} fallback={<p className="text-sm text-muted-foreground">Billing run access is unavailable for your account.</p>}><BillingRunDetail schoolId={schoolId} sessionId={sessionId} billRunId={billRunId} /></RequirePermissions>; }
