import { SCHOOL_ACTIONS } from "@campuspilot/api/routers/authorization/authorization.dto";
import { BillingReports } from "@/components/billing/billing-reports";
import { RequirePermissions } from "@/components/require-permissions";
export default async function Page({ params }: { params: Promise<{ schoolId: string; sessionId: string }> }) { const { schoolId, sessionId } = await params; return <RequirePermissions permissions={{ action: SCHOOL_ACTIONS.READ_BILLING_REPORTS, resource: { kind: "school", schoolId } }} fallback={<p className="text-sm text-muted-foreground">Finance report access is unavailable for your account.</p>}><BillingReports schoolId={schoolId} sessionId={sessionId} /></RequirePermissions>; }
