import type { ReactNode } from "react";
import { BillingWorkspace } from "@/components/billing/billing-workspace";
import { FeaturePage } from "@/components/feature-unavailable";

export default async function BillingLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ schoolId: string; sessionId: string }>;
}) {
  const { schoolId, sessionId } = await params;
  // Fees and billing belong to student management.
  return (
    <FeaturePage feature="studentManagement">
      <BillingWorkspace schoolId={schoolId} sessionId={sessionId}>{children}</BillingWorkspace>
    </FeaturePage>
  );
}

