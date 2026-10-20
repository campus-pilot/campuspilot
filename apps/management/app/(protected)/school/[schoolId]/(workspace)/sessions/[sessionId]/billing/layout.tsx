import type { ReactNode } from "react";
import { BillingWorkspace } from "@/components/billing/billing-workspace";

export default async function BillingLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ schoolId: string; sessionId: string }>;
}) {
  const { schoolId, sessionId } = await params;
  return <BillingWorkspace schoolId={schoolId} sessionId={sessionId}>{children}</BillingWorkspace>;
}

