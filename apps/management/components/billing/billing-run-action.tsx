"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@campuspilot/ui/components/button";
import { Plus } from "lucide-react";
import Link from "next/link";
import { SCHOOL_ACTIONS } from "@campuspilot/api/routers/authorization/authorization.dto";
import { schoolHref } from "@/components/school-route";
import { orpc } from "@/lib/orpc";
import { RequireFeature } from "@/components/require-feature";
import { RequirePermissions } from "@/components/require-permissions";
import { BillingRunDialog } from "./billing-run-dialog";

/**
 * "Create billing run" with its feature and permission gates (separate gates;
 * the action needs both), so the Billing navbar and the empty Cycle table
 * render the same entry point.
 */
export function BillingRunAction({ schoolId, sessionId, variant = "default", explainUnready = false }: {
  schoolId: string;
  sessionId: string;
  variant?: "default" | "outline";
  /** Say why the button is disabled when the finance settings are not ready (empty states have room; the navbar has not). */
  explainUnready?: boolean;
}) {
  return (
    <RequireFeature schoolId={schoolId} feature="studentManagement">
      <RequirePermissions permissions={[
        SCHOOL_ACTIONS.READ_SESSION_FINANCE,
        SCHOOL_ACTIONS.PREVIEW_BILLING_RUN,
        SCHOOL_ACTIONS.POST_BILLING_RUN,
      ].map((action) => ({ action, resource: { kind: "school" as const, schoolId } }))}>
        <BillingRunButton schoolId={schoolId} sessionId={sessionId} variant={variant} explainUnready={explainUnready} />
      </RequirePermissions>
    </RequireFeature>
  );
}

/** Why billing is not possible yet, with the session settings page where finance is configured. */
function UnreadyForBilling({ schoolId, sessionId }: { schoolId: string; sessionId: string }) {
  return (
    <p className="text-xs text-muted-foreground">
      Finish the session&apos;s finance settings before creating a billing run.{" "}
      <Link className="underline underline-offset-2" href={schoolHref(schoolId, `/settings/session/${encodeURIComponent(sessionId)}`)}>Open session settings</Link>
    </p>
  );
}

/** Owns billing-run readiness and dialog state so the action can live in the navbar. */
function BillingRunButton({ schoolId, sessionId, variant, explainUnready }: { schoolId: string; sessionId: string; variant: "default" | "outline"; explainUnready: boolean }) {
  const [open, setOpen] = useState(false);
  const financeQuery = useQuery(orpc.school.getSessionFinance.queryOptions({ input: { schoolId, sessionId } }));
  if (financeQuery.isPending) return <Button type="button" variant={variant} disabled><Plus aria-hidden />Create billing run</Button>;
  if (financeQuery.isError || !financeQuery.data) return null;
  const finance = financeQuery.data;
  const elements = Object.entries(finance.financeConfig?.elements ?? {})
    .filter(([, element]) => element.requiredAtLevel === "bill_generation")
    .map(([slug, element]) => ({ slug, name: element.name, scopes: element.scopes }));
  const ready = finance.configurationReadiness.readyForBilling;
  return (
    <>
      {explainUnready && !ready ? <UnreadyForBilling schoolId={schoolId} sessionId={sessionId} /> : null}
      <Button type="button" variant={variant} disabled={!ready} onClick={() => setOpen(true)}>
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
