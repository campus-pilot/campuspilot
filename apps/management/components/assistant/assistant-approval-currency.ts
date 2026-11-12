import type { AssistantToolCallItemDto } from '@campuspilot/assistant-contract/dto';
import { SCHOOL_ACTIONS } from '@campuspilot/api/routers/authorization/authorization.dto';
import type { ApprovalPath } from '@campuspilot/components/assistant';
import { useQuery } from '@tanstack/react-query';

import { permissionsSatisfied } from '@/components/require-permissions-model';
import { orpc } from '@/lib/orpc';

import { approvalMoneyPlan } from './assistant-approval-money';
import { retryUnlessRefused } from './assistant-stream';

/**
 * How the approval request reads the waiting call's money (see
 * `approvalMoneyPlan`). A session's finance currency is read with the user's
 * own session through `getSessionFinance`, and only once the same
 * permission check `RequirePermissions` uses says the user may read session
 * finance: without it, or until it answers, those amounts show as minor
 * units and no read is issued that would be refused.
 */
export function useApprovalMoney(
  schoolId: string,
  call: AssistantToolCallItemDto | undefined,
): { currency?: string; moneyMaps?: readonly ApprovalPath[] } {
  const plan = call ? approvalMoneyPlan(call.body.toolName, call.body.input) : {};
  const sessionId = plan.lookupSessionId;
  const permission = useQuery({
    ...orpc.authorization.checkPermissions.queryOptions({
      input: { permissions: [{ action: SCHOOL_ACTIONS.READ_SESSION_FINANCE, resource: { kind: 'school', schoolId } }] },
    }),
    enabled: Boolean(sessionId),
  });
  const mayRead = permissionsSatisfied(
    { isPending: permission.isPending, isError: permission.isError, results: permission.data?.results },
    1,
  );
  const finance = useQuery({
    ...orpc.school.getSessionFinance.queryOptions({ input: { schoolId, sessionId: sessionId ?? '' } }),
    enabled: Boolean(sessionId) && mayRead,
    retry: retryUnlessRefused,
  });
  const sessionCurrency = sessionId && mayRead ? (finance.data?.financeConfig?.currency ?? undefined) : undefined;
  return { currency: plan.inputCurrency ?? sessionCurrency, moneyMaps: plan.moneyMaps };
}
