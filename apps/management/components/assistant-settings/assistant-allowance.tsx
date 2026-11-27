'use client';

import type { SchoolAssistantAllowance } from '@campuspilot/api/routers/school/assistant-access/assistant-access.dto';
import { AllowanceMeter } from '@campuspilot/components/assistant-allowance';
import { resolveQueryBoundary } from '@campuspilot/components/query-boundary';
import { useQuery } from '@tanstack/react-query';

import { orpc } from '@/lib/orpc';

/**
 * The school's AI allowance this period (`school.getAssistantAllowance`), as
 * a percentage, never dollars. Readable by the principal and manager only
 * (`READ_ASSISTANT_USAGE`): gate whatever shows it with that permission.
 * Settings › Usage and Settings › AI assistant share the one query.
 */
export function useAssistantAllowance(schoolId: string) {
  return resolveQueryBoundary<SchoolAssistantAllowance>(useQuery(orpc.school.getAssistantAllowance.queryOptions({ input: { schoolId } })));
}

/**
 * The total is the limit check's cached figure, so its exact age is unknown,
 * only its bound. There is deliberately no Refresh: reading again cannot make
 * that cache fresher.
 */
function freshnessNote(maxAgeSeconds: number): string {
  return `Updated within the last ${Math.round(maxAgeSeconds / 60)} minutes.`;
}

/** The meter of a school with a limit; nothing for one without (there is no share to show). */
export function SchoolAllowanceMeter({ allowance }: { allowance: SchoolAssistantAllowance }) {
  if (!allowance.limited || allowance.usedPercent === null) return null;
  return <AllowanceMeter usedPercent={allowance.usedPercent} resetsAt={allowance.windowEnd} note={freshnessNote(allowance.maxAgeSeconds)} />;
}

/** The text of a failed read, for the place the allowance would be. */
export function allowanceErrorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'The AI allowance could not be loaded.';
}

/**
 * The allowance meter on its own, for Settings › AI assistant: nothing while
 * it loads, and nothing for a school without a limit (the card's text says so).
 */
export function AssistantAllowanceSummary({ schoolId }: { schoolId: string }) {
  const state = useAssistantAllowance(schoolId);
  if (state.kind === 'pending') return null;
  if (state.kind === 'failed') return <p className="text-sm text-destructive">{allowanceErrorText(state.error)}</p>;
  return <SchoolAllowanceMeter allowance={state.data} />;
}
