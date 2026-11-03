"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@campuspilot/ui/components/button";
import { Plus } from "lucide-react";
import { orpc } from "@/lib/orpc";
import { BillingRunDialog } from "./billing-run-dialog";

/** Owns billing-run readiness and dialog state so the action can live in the navbar. */
export function BillingRunAction({ schoolId, sessionId }: { schoolId: string; sessionId: string }) {
  const [open, setOpen] = useState(false);
  const financeQuery = useQuery(orpc.school.getSessionFinance.queryOptions({ input: { schoolId, sessionId } }));
  if (financeQuery.isPending) return <Button type="button" disabled><Plus aria-hidden />Create billing run</Button>;
  if (financeQuery.isError || !financeQuery.data) return null;
  const finance = financeQuery.data;
  const elements = Object.entries(finance.financeConfig?.elements ?? {})
    .filter(([, element]) => element.requiredAtLevel === "bill_generation")
    .map(([slug, element]) => ({ slug, name: element.name, scopes: element.scopes }));
  return (
    <>
      <Button type="button" disabled={!finance.configurationReadiness.readyForBilling} onClick={() => setOpen(true)}>
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
