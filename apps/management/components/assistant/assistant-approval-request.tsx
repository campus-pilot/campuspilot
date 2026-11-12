'use client';

import type { AssistantToolCallItemDto } from '@campuspilot/assistant-contract/dto';
import {
  approvalPaperScope,
  approvalSummaryOf,
  AssistantApprovalRequest,
  type AssistantApprovalDecision,
} from '@campuspilot/components/assistant';
import { useQuery } from '@tanstack/react-query';

import { orpc } from '@/lib/orpc';

import { approvalFactsOf } from './assistant-question-paper-model';
import { retryUnlessRefused } from './assistant-stream';
import { useAssistantTimeline } from './use-assistant';

/**
 * The approval request with the tool's own sentence when the tool has a
 * summary in the registry (`approval-summaries.ts`): the app resolves the
 * facts the sentence needs (the paper's names, the draft's place in this chat)
 * and the components package formats it. A tool without an entry, or a
 * paper whose names could not be read yet, shows the generic list or the
 * sentence with plain words ("this paper"); approving is never blocked by a lookup.
 */
export function AssistantApprovalWithSummary({
  schoolId,
  conversationId,
  call,
  waiting,
  pendingDecision,
  error,
  currency,
  moneyMaps,
  onDecide,
}: {
  schoolId: string;
  conversationId: string;
  call: AssistantToolCallItemDto;
  waiting: number;
  pendingDecision?: AssistantApprovalDecision;
  error?: string | null;
  /** Passed through to the card: how to read money amounts that do not name their own currency. */
  currency?: string;
  /** Passed through to the card: paths of fee-slug maps whose values are minor-unit amounts. */
  moneyMaps?: readonly (readonly string[])[];
  onDecide: (decision: AssistantApprovalDecision) => void;
}) {
  const { toolName, input } = call.body;
  const scope = approvalPaperScope(toolName, input);
  const rows = useAssistantTimeline(schoolId, conversationId);
  const detail = useQuery({
    ...orpc.school.getQuestionPaperDetail.queryOptions({
      input: { schoolId, sessionId: '', examSlug: '', classId: '', subjectSlug: '', modeSlug: '', ...scope },
    }),
    enabled: Boolean(scope),
    retry: retryUnlessRefused,
  });
  const facts = approvalFactsOf({ toolName, input, rows: rows ?? [], paper: detail.data?.paper ?? null });
  return (
    <AssistantApprovalRequest
      call={call}
      waiting={waiting}
      pendingDecision={pendingDecision}
      error={error}
      summary={approvalSummaryOf(toolName, input, facts)}
      currency={currency}
      moneyMaps={moneyMaps}
      onDecide={onDecide}
    />
  );
}
