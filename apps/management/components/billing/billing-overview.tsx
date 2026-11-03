import { BillingReports } from "./billing-reports";

export function BillingOverview({ schoolId, sessionId }: { schoolId: string; sessionId: string }) {
  return <BillingReports schoolId={schoolId} sessionId={sessionId} />;
}
