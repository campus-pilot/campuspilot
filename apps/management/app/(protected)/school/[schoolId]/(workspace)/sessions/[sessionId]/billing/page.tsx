import { SCHOOL_ACTIONS } from "@campuspilot/api/routers/authorization/authorization.dto";
import { BillingOverview } from "@/components/billing/billing-overview";
import { RequirePermissions } from "@/components/require-permissions";

export default async function BillingPage({ params }: { params: Promise<{ schoolId: string; sessionId: string }> }) {
  const { schoolId, sessionId } = await params;
  const resource = { kind: "school" as const, schoolId };
  return <RequirePermissions permissions={{ action: SCHOOL_ACTIONS.READ_BILLING_REPORTS, resource }} fallback={<p className="text-sm text-muted-foreground">Billing overview access is unavailable for your account.</p>}><BillingOverview schoolId={schoolId} sessionId={sessionId} /></RequirePermissions>;
}
