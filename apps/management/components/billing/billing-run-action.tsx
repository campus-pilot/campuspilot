"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@campuspilot/ui/components/button";
import { Plus } from "lucide-react";
import { SCHOOL_ACTIONS } from "@campuspilot/api/routers/authorization/authorization.dto";
import { orpc } from "@/lib/orpc";
import { RequireFeature } from "@/components/require-feature";
import { RequirePermissions } from "@/components/require-permissions";
import { BillingRunDialog } from "./billing-run-dialog";

/**
 * "Create billing run" with its feature and permission gates (separate gates;
 * the action needs both), so the Billing navbar and the empty Cycle table
 * render the same entry point.
 */
export function BillingRunAction({ schoolId, sessionId, variant = "default" }: { schoolId: string; sessionId: string; variant?: "default" | "outline" }) {
  return (
    <RequireFeature schoolId={schoolId} feature="studentManagement">
      <RequirePermissions permissions={[
        SCHOOL_ACTIONS.READ_SESSION_FINANCE,
        SCHOOL_ACTIONS.PREVIEW_BILLING_RUN,
        SCHOOL_ACTIONS.POST_BILLING_RUN,
      ].map((action) => ({ action, resource: { kind: "school" as const, schoolId } }))}>
        <BillingRunButton schoolId={schoolId} sessionId={sessionId} variant={variant} />
      </RequirePermissions>
    </RequireFeature>
  );
}

/** Owns billing-run readiness and dialog state so the action can live in the navbar. */
function BillingRunButton({ schoolId, sessionId, variant }: { schoolId: string; sessionId: string; variant: "default" | "outline" }) {
  const [open, setOpen] = useState(false);
  const financeQuery = useQuery(orpc.school.getSessionFinance.queryOptions({ input: { schoolId, sessionId } }));
  if (financeQuery.isPending) return <Button type="button" variant={variant} disabled><Plus aria-hidden />Create billing run</Button>;
  if (financeQuery.isError || !financeQuery.data) return null;
  const finance = financeQuery.data;
  const elements = Object.entries(finance.financeConfig?.elements ?? {})
    .filter(([, element]) => element.requiredAtLevel === "bill_generation")
    .map(([slug, element]) => ({ slug, name: element.name, scopes: element.scopes }));
  return (
    <>
      <Button type="button" variant={variant} disabled={!finance.configurationReadiness.readyForBilling} onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        Create billing run
      </Button>
      {open && finance.financeConfig?.currency && finance.financeConfig.timeZone ? (
        <BillingRunDialog
          open
          schoolId={schoolId}
          sessionId={sessionId}
          currency={finance.financeConfig.currency}
          timeZone={finance.financeConfig.timeZone}
          runtimeElements={elements}
          onOpenChange={setOpen}
        />
      ) : null}
    </>
  );
}
