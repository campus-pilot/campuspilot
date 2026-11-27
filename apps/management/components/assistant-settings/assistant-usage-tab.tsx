'use client';

import type { SchoolAssistantAllowance } from '@campuspilot/api/routers/school/assistant-access/assistant-access.dto';
import { AllowanceUsersTable } from '@campuspilot/components/assistant-allowance';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@campuspilot/ui/components/card';

import { allowanceErrorText, SchoolAllowanceMeter, useAssistantAllowance } from './assistant-allowance';

/** Each person's share, largest first; a period nobody has used yet says so. */
function AllowanceUsers({ users }: { users: SchoolAssistantAllowance['users'] }) {
  if (users.length === 0) return <p className="text-sm text-muted-foreground">Nobody has used the assistant this period yet.</p>;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">By person</h3>
      <AllowanceUsersTable rows={users} />
    </div>
  );
}

/** The period's allowance: the meter and who used it, or one line for a plan without a limit. */
function AllowanceDetails({ allowance }: { allowance: SchoolAssistantAllowance }) {
  if (!allowance.limited) return <p className="text-sm text-muted-foreground">Your plan has no AI usage limit.</p>;
  return (
    <div className="flex flex-col gap-6">
      <SchoolAllowanceMeter allowance={allowance} />
      <AllowanceUsers users={allowance.users} />
    </div>
  );
}

function AllowanceBody({ schoolId }: { schoolId: string }) {
  const state = useAssistantAllowance(schoolId);
  if (state.kind === 'pending') return <div className="h-40 animate-pulse rounded-lg bg-muted" />;
  if (state.kind === 'failed') return <p className="text-sm text-destructive">{allowanceErrorText(state.error)}</p>;
  return <AllowanceDetails allowance={state.data} />;
}

/**
 * Settings › Usage › AI usage: the current period only. How much of the
 * plan's AI allowance the school has used, as a percentage with the reset
 * date, and each person's share. Never amounts of money (those stay in the
 * admin app). The period is the one the limit counts (28-day steps of the
 * billing period, or the IST calendar month without one).
 */
export function AssistantUsageTab({ schoolId }: { schoolId: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>AI allowance</CardTitle>
        <CardDescription>How much of this period’s AI allowance your school has used, and by whom.</CardDescription>
      </CardHeader>
      <CardContent>
        <AllowanceBody schoolId={schoolId} />
      </CardContent>
    </Card>
  );
}
