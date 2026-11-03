"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { SCHOOL_ACTIONS } from "@campuspilot/api/routers/authorization/authorization.dto";
import { AppShellAlert } from "@campuspilot/components/app-shell";
import { WorkspaceNavigationLayout } from "@campuspilot/components/workspace-navigation-layout";
import { Tabs, TabsList, TabsTrigger } from "@campuspilot/ui/components/tabs";
import { CreditCard } from "lucide-react";
import { orpc } from "@/lib/orpc";
import { RequirePermissions } from "@/components/require-permissions";
import { confirmNavigation } from "@/lib/navigation-guard";

const sections = [
  { id: "overview", label: "Overview", suffix: "", action: SCHOOL_ACTIONS.READ_BILLING_REPORTS },
  { id: "runs", label: "Cycle", suffix: "/runs", action: SCHOOL_ACTIONS.READ_BILLING_RUNS },
  { id: "payments", label: "Payments", suffix: "/payments", action: SCHOOL_ACTIONS.READ_ADMISSION_LEDGER },
] as const;

function closeAlertDialog(closeDialog: () => void) {
  closeDialog();
}

function FinanceReadinessAlert({ schoolId, sessionId }: { schoolId: string; sessionId: string }) {
  const financeQuery = useQuery(orpc.school.getSessionFinance.queryOptions({ input: { schoolId, sessionId } }));
  const readiness = financeQuery.data?.configurationReadiness;
  if (!readiness || readiness.readyForBilling) return null;
  const missing = readiness.missingFields.map((field) => field === "timeZone" ? "timezone" : field === "cycleStartMonth" ? "cycle start month" : field).join(", ");
  const message = readiness.status === "not_configured"
    ? "Finance configuration is required before bills can be posted."
    : `Finance configuration is incomplete${missing ? `: ${missing}` : ""}.`;
  const alertSlug = `school/${schoolId}/session/${sessionId}/finance-setup`;
  const resource = { kind: "school" as const, schoolId };

  return (
    <>
      <AppShellAlert slug={alertSlug} type="warning" message={message} />
      <RequirePermissions permissions={{ action: SCHOOL_ACTIONS.UPDATE_SESSION_FINANCE, resource }}>
        <AppShellAlert
          slug={alertSlug}
          type="warning"
          message={message}
          actionLabel="Configure finance"
          actionHref={`/school/${encodeURIComponent(schoolId)}/settings/session/${encodeURIComponent(sessionId)}`}
          onAction={closeAlertDialog}
        />
      </RequirePermissions>
    </>
  );
}

export function BillingWorkspace({
  children,
  schoolId,
  sessionId,
}: {
  children: ReactNode;
  schoolId: string;
  sessionId: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const resource = { kind: "school" as const, schoolId };
  const baseHref = `/school/${encodeURIComponent(schoolId)}/sessions/${encodeURIComponent(sessionId)}/billing`;
  const active = sections.find((section) => section.suffix && pathname.includes(`${baseHref}${section.suffix}`)) ?? sections[0];
  return (
    <>
      <RequirePermissions permissions={{ action: SCHOOL_ACTIONS.READ_SESSION_FINANCE, resource }}>
        <FinanceReadinessAlert schoolId={schoolId} sessionId={sessionId} />
      </RequirePermissions>
      <WorkspaceNavigationLayout
        heading={(
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <CreditCard className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Session finance</p>
              <h1 className="truncate text-xl font-semibold tracking-tight">Billing</h1>
            </div>
          </div>
        )}
        actions={null}
        navigationLabel="Billing sections"
        navigation={(
          <Tabs value={active.id} onValueChange={async (value) => {
            const next = sections.find((section) => section.id === value);
            if (next && await confirmNavigation()) router.push(`${baseHref}${next.suffix}`);
          }}>
            <TabsList variant="line" className="h-auto">
              {sections.map((section) => (
                <RequirePermissions key={section.id} permissions={{ action: section.action, resource }}>
                  <TabsTrigger value={section.id} className="h-9 flex-none px-3 text-sm">{section.label}</TabsTrigger>
                </RequirePermissions>
              ))}
            </TabsList>
          </Tabs>
        )}
      >
        {children}
      </WorkspaceNavigationLayout>
    </>
  );
}
