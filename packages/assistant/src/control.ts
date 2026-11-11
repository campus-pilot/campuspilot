import { ASSISTANT_TERMINAL_RUN_STATUSES } from '@campuspilot/assistant-contract/dto';
import { authenticateControlCall } from '@campuspilot/api/workflows/control-service-auth';
import { user as userTable } from '@campuspilot/db/schema/auth';
import * as restate from '@restatedev/restate-sdk';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { ASSISTANT_CONTROL_SERVICE_NAME } from './control-constants';
import { db } from './db';
import { log } from './log';
import {
  ASSISTANT_CONVERSATION_OBJECT,
  type ApprovalResolution,
  type AssistantConversationHandlers,
  type ProcessRunInput,
} from './runtime/contract';
import * as store from './store';

/** Input of `AssistantControl.startRun`; parsed before any journal entry. */
export const assistantStartRunInputSchema = z.object({ runId: z.string().regex(/^asr_[a-z0-9]{21}$/) });
export type AssistantStartRunInput = z.infer<typeof assistantStartRunInputSchema>;

/** Input of `AssistantControl.resolveApproval`; parsed before any journal entry. */
export const assistantResolveApprovalInputSchema = z.object({ approvalId: z.string().regex(/^asa_[a-z0-9]{21}$/) });
export type AssistantResolveApprovalInput = z.infer<typeof assistantResolveApprovalInputSchema>;

/** The conversation object by name only, so this service does not build the turn loop. */
const conversationObject = { name: ASSISTANT_CONVERSATION_OBJECT } as restate.VirtualObjectDefinition<
  typeof ASSISTANT_CONVERSATION_OBJECT,
  AssistantConversationHandlers
>;

/** A database step with bounded retries and a generic failure text (no SQL in the journal). */
function safeRun<T>(ctx: restate.Context, name: string, action: () => Promise<T>) {
  return ctx.run(
    name,
    async () => {
      try {
        return await action();
      } catch (error) {
        log.error({ service: ASSISTANT_CONTROL_SERVICE_NAME, step: name, err: error instanceof Error ? error.name : 'unknown' }, 'assistant.control.error');
        throw new Error('A database operation failed; the worker log has the details.');
      }
    },
    { maxRetryAttempts: 5 },
  );
}

/** What a decided approval resumes its run with; null while it is still pending. */
const RESOLUTION: Record<Exclude<store.ApprovalRow['status'], 'pending'>, ApprovalResolution['decision']> = {
  approved: 'approve',
  declined: 'decline',
  cancelled: 'cancel',
};

/**
 * `AssistantControl` is the only assistant service reachable through Restate
 * ingress; the `assistantConversation` object is `ingressPrivate`. The API
 * hands work over with one-way, idempotent, signed sends (outbox in
 * `dispatch.ts`), so no request waits for the worker. Each handler is, in
 * order: Zod-parsed, authenticated by its HMAC signature
 * (`WORKER_CONTROL_SECRET`), checked against the database, and only then acts.
 */
export const assistantControlService = restate.service({
  name: ASSISTANT_CONTROL_SERVICE_NAME,
  handlers: {
    /**
     * Starts a saved run's turn on its conversation's object. Only a run
     * that has not ended is started; the user's name and email for the
     * prompt are read from their account now. An account deleted since gets
     * a neutral placeholder: the API refuses every tool call of a user that
     * no longer exists, so the turn cannot act for it.
     */
    startRun: async (ctx: restate.Context, rawInput: AssistantStartRunInput): Promise<{ status: 'started' | 'not_queued' }> => {
      const parsed = assistantStartRunInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new restate.TerminalError('Invalid assistant run start.', { errorCode: 400 });
      const input = parsed.data;
      await authenticateControlCall(ctx, { service: ASSISTANT_CONTROL_SERVICE_NAME, handler: 'startRun', input, log });
      const target = await safeRun(ctx, 'load-run', async () => {
        const run = await store.findRun(db, input.runId);
        if (!run || ASSISTANT_TERMINAL_RUN_STATUSES.has(run.status)) return null;
        const [account] = await db
          .select({ name: userTable.name, email: userTable.email })
          .from(userTable)
          .where(eq(userTable.id, run.userId))
          .limit(1);
        return { conversationId: run.conversationId, user: account ?? { name: 'Unknown user', email: '' } };
      });
      if (!target) return { status: 'not_queued' };
      const processInput: ProcessRunInput = { runId: input.runId, user: target.user };
      ctx.objectSendClient(conversationObject, target.conversationId).processRun(processInput);
      return { status: 'started' };
    },
    /**
     * Wakes a run that waits on an approval with the decision saved on the
     * approval row (approved, declined, or cancelled by a stop). A pending
     * approval is never resolved: the decision is the database's, not the
     * caller's.
     */
    resolveApproval: async (
      ctx: restate.Context,
      rawInput: AssistantResolveApprovalInput,
    ): Promise<{ status: 'resolved' | 'not_decided' }> => {
      const parsed = assistantResolveApprovalInputSchema.safeParse(rawInput);
      if (!parsed.success) throw new restate.TerminalError('Invalid assistant approval resolution.', { errorCode: 400 });
      const input = parsed.data;
      await authenticateControlCall(ctx, { service: ASSISTANT_CONTROL_SERVICE_NAME, handler: 'resolveApproval', input, log });
      const target = await safeRun(ctx, 'load-approval', async () => {
        const approval = await store.findApproval(db, input.approvalId);
        if (!approval || approval.status === 'pending') return null;
        return { awakeableId: approval.awakeableId, decision: RESOLUTION[approval.status] };
      });
      if (!target) return { status: 'not_decided' };
      ctx.resolveAwakeable<ApprovalResolution>(target.awakeableId, { decision: target.decision });
      return { status: 'resolved' };
    },
  },
});

export type AssistantControlService = typeof assistantControlService;
