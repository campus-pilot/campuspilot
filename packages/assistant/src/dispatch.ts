import { signWorkerControlCall } from '@campuspilot/api/workflows/control-auth';
import {
  assistantApprovalTable,
  assistantRunTable,
} from '@campuspilot/db/schema/assistant';
import { env } from '@campuspilot/env/server';
import { getRestateClient, rpc } from '@campuspilot/restate/client';
import { and, asc, eq, inArray, isNull, lt, ne, sql } from 'drizzle-orm';

import {
  ASSISTANT_CONTROL_SERVICE_NAME,
  assistantApprovalHandoverKey,
  assistantRunHandoverKey,
  type AssistantControlHandler,
} from './control-constants';
import type { AssistantControlService } from './control';
import { db as defaultDb, type AssistantDatabase } from './db';
import { log } from './log';
import * as store from './store';

/**
 * The assistant's outbox, API side. Saved rows are the durable record of
 * work the API owes the worker:
 * - a run with `handed_over_at` null still has to be started
 *   (`AssistantControl.startRun`);
 * - a decided approval with `resolution_handed_over_at` null still has to
 *   wake its run (`AssistantControl.resolveApproval`).
 * Requests save the row, then hand it over right after commit
 * ({@link handOverRun}, {@link handOverApprovalResolution}); a failed
 * hand-over is recorded on the row and left to the sweep
 * ({@link sweepAssistantOutbox}, on the API server's 30 s loop), so a request
 * never fails, or waits for the worker, because Restate is briefly away. A
 * run Restate has not accepted within {@link RUN_HANDOVER_DEADLINE_MS} is
 * failed visibly so the user can send again; a decision is re-sent until it
 * is accepted, since the run waits for it. A run Restate accepted that never
 * started within the same deadline (the worker never ran it) is failed too
 * (`not_started`), unless an earlier run of its conversation is still
 * unfinished: the conversation's object runs one turn at a time, so a run
 * may rightly wait behind one that waits for approval.
 */

/** Rows handled per kind and sweep; the next sweep continues with the rest. */
const SWEEP_LIMIT = 20;
/** A run Restate has not accepted after this long fails visibly. */
export const RUN_HANDOVER_DEADLINE_MS = 10 * 60 * 1000;
/** Rows younger than this are left to the request that saved them. */
const SWEEP_GRACE_MS = 15 * 1000;
/** Bound for one send: Restate itself, not the worker, must answer within it. */
const SEND_TIMEOUT_MS = 5_000;

/** Sends one signed hand-over to the worker; resolves once Restate accepted it. */
export type AssistantDispatcher = {
  startRun: (input: { runId: string }) => Promise<void>;
  resolveApproval: (input: { approvalId: string }) => Promise<void>;
};

function signedSendOptions<I>(handler: AssistantControlHandler, input: I, idempotencyKey: string) {
  const secret = env.WORKER_CONTROL_SECRET;
  if (!secret) throw new Error('WORKER_CONTROL_SECRET is not set, so worker control calls cannot be signed.');
  const headers = signWorkerControlCall(secret, { service: ASSISTANT_CONTROL_SERVICE_NAME, handler }, input);
  return rpc.sendOpts<I>({ idempotencyKey, headers, timeout: SEND_TIMEOUT_MS });
}

function controlSend() {
  return getRestateClient().serviceSendClient<AssistantControlService>({ name: ASSISTANT_CONTROL_SERVICE_NAME });
}

/**
 * One-way, idempotent, signed sends to `AssistantControl`: Restate answers
 * as soon as it has durably accepted the call, whether or not a worker is
 * running, and a repeated send under the same key joins the first one.
 */
const restateDispatcher: AssistantDispatcher = {
  async startRun({ runId }) {
    const input = { runId };
    await controlSend().startRun(input, signedSendOptions('startRun', input, assistantRunHandoverKey(runId)));
  },
  async resolveApproval({ approvalId }) {
    const input = { approvalId };
    await controlSend().resolveApproval(
      input,
      signedSendOptions('resolveApproval', input, assistantApprovalHandoverKey(approvalId)),
    );
  },
};

let dispatcher: AssistantDispatcher = restateDispatcher;

/** Replaces the Restate sends (tests). */
export function configureDispatcher(next: AssistantDispatcher | null) {
  dispatcher = next ?? restateDispatcher;
}

/** Safe one-line description of a hand-over failure (no URLs or secrets). */
function describeHandoverError(error: unknown) {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return 'Restate did not answer in time.';
  if (error instanceof Error && /WORKER_CONTROL_SECRET/.test(error.message)) return error.message;
  return 'Restate is unreachable.';
}

/**
 * Hands a saved run's start to the worker, once. Only a run that is still
 * queued and not yet accepted is sent; a failure is recorded on the run for
 * the sweep. True when Restate accepted it.
 */
export async function handOverRun(runId: string, db: AssistantDatabase = defaultDb): Promise<boolean> {
  const owed = and(eq(assistantRunTable.id, runId), eq(assistantRunTable.status, 'queued'), isNull(assistantRunTable.handedOverAt));
  const [run] = await db.select({ id: assistantRunTable.id }).from(assistantRunTable).where(owed).limit(1);
  if (!run) return false;
  try {
    await dispatcher.startRun({ runId });
    await db
      .update(assistantRunTable)
      .set({
        handedOverAt: new Date(),
        handoverAttempts: sql`${assistantRunTable.handoverAttempts} + 1`,
        lastHandoverError: null,
      })
      .where(and(eq(assistantRunTable.id, runId), isNull(assistantRunTable.handedOverAt)));
    return true;
  } catch (error) {
    const reason = describeHandoverError(error);
    await db
      .update(assistantRunTable)
      .set({ handoverAttempts: sql`${assistantRunTable.handoverAttempts} + 1`, lastHandoverError: reason })
      .where(and(eq(assistantRunTable.id, runId), isNull(assistantRunTable.handedOverAt)));
    log.warn({ runId, reason }, 'assistant.run.handover.failed');
    return false;
  }
}

/**
 * Hands a decided approval to the worker, which wakes its run with the
 * decision saved on the row. A pending or already handed-over approval is
 * not sent. True when Restate accepted it.
 */
export async function handOverApprovalResolution(approvalId: string, db: AssistantDatabase = defaultDb): Promise<boolean> {
  const owed = and(
    eq(assistantApprovalTable.id, approvalId),
    ne(assistantApprovalTable.status, 'pending'),
    isNull(assistantApprovalTable.resolutionHandedOverAt),
  );
  const [approval] = await db.select({ id: assistantApprovalTable.id }).from(assistantApprovalTable).where(owed).limit(1);
  if (!approval) return false;
  try {
    await dispatcher.resolveApproval({ approvalId });
    await db
      .update(assistantApprovalTable)
      .set({
        resolutionHandedOverAt: new Date(),
        resolutionHandoverAttempts: sql`${assistantApprovalTable.resolutionHandoverAttempts} + 1`,
        lastResolutionHandoverError: null,
      })
      .where(owed);
    return true;
  } catch (error) {
    const reason = describeHandoverError(error);
    await db
      .update(assistantApprovalTable)
      .set({
        resolutionHandoverAttempts: sql`${assistantApprovalTable.resolutionHandoverAttempts} + 1`,
        lastResolutionHandoverError: reason,
      })
      .where(owed);
    log.warn({ approvalId, reason }, 'assistant.approval.handover.failed');
    return false;
  }
}

/**
 * Finds queued runs Restate has not accepted and fails those past the
 * deadline, through the store so open conversations see it. Returns the rest
 * to send. Replicas sweeping at the same time may pick the same rows: that is
 * harmless, because a send joins Restate's first invocation (same
 * idempotency key) and every write is conditional on the row still being
 * owed. (The `FOR UPDATE SKIP LOCKED` only spreads a busy sweep; its lock
 * ends with the select.)
 */
async function claimRunsToHandOver(db: AssistantDatabase): Promise<{ toSend: string[]; expired: number }> {
  const graceCutoff = new Date(Date.now() - SWEEP_GRACE_MS);
  const rows = await db.transaction((tx) =>
    tx
      .select({ id: assistantRunTable.id, conversationId: assistantRunTable.conversationId, createdAt: assistantRunTable.createdAt })
      .from(assistantRunTable)
      .where(
        and(
          eq(assistantRunTable.status, 'queued'),
          isNull(assistantRunTable.handedOverAt),
          lt(assistantRunTable.createdAt, graceCutoff),
        ),
      )
      .orderBy(asc(assistantRunTable.createdAt))
      .limit(SWEEP_LIMIT)
      .for('update', { skipLocked: true }),
  );
  const deadline = Date.now() - RUN_HANDOVER_DEADLINE_MS;
  let expired = 0;
  const toSend: string[] = [];
  for (const row of rows) {
    if (row.createdAt.getTime() >= deadline) {
      toSend.push(row.id);
      continue;
    }
    const failed = await store.assistantTransaction(db, async (tx, emit) => {
      const current = await store.lockRun(tx, row.id);
      if (!current || current.status !== 'queued' || current.handedOverAt) return false;
      await store.updateRun(tx, emit, current, {
        status: 'failed',
        errorCode: 'dispatch_failed',
        errorMessage: 'The assistant could not start. Please try again.',
        errorDetail: current.lastHandoverError,
        completedAt: new Date(),
      });
      return true;
    });
    if (failed) {
      expired += 1;
      log.warn({ runId: row.id }, 'assistant.run.handover.expired');
    }
  }
  return { toSend, expired };
}

/**
 * Fails runs Restate accepted more than {@link RUN_HANDOVER_DEADLINE_MS} ago
 * that never started, unless an earlier run of the same conversation is not
 * finished (they queue behind it). Each is failed under its row lock and only
 * while still queued and unstarted; if the worker starts it later, `begin`
 * finds it ended and does nothing.
 */
async function failUnstartedRuns(db: AssistantDatabase): Promise<number> {
  const cutoff = new Date(Date.now() - RUN_HANDOVER_DEADLINE_MS);
  const rows = await db
    .select({ id: assistantRunTable.id })
    .from(assistantRunTable)
    .where(
      and(
        eq(assistantRunTable.status, 'queued'),
        isNull(assistantRunTable.startedAt),
        lt(assistantRunTable.handedOverAt, cutoff),
        sql`not exists (select 1 from ${assistantRunTable} as earlier
          where earlier.conversation_id = ${assistantRunTable}.conversation_id
            and earlier.id <> ${assistantRunTable}.id
            and earlier.created_at <= ${assistantRunTable}.created_at
            and earlier.status in ('queued', 'running', 'awaiting_approval'))`,
      ),
    )
    .orderBy(asc(assistantRunTable.handedOverAt))
    .limit(SWEEP_LIMIT);
  let failed = 0;
  for (const row of rows) {
    const done = await store.assistantTransaction(db, async (tx, emit) => {
      const current = await store.lockRun(tx, row.id);
      if (!current || current.status !== 'queued' || current.startedAt) return false;
      await store.updateRun(tx, emit, current, {
        status: 'failed',
        errorCode: 'not_started',
        errorMessage: 'The assistant did not start on this message. Please try again.',
        errorDetail: 'Restate accepted the run but the worker never started it.',
        completedAt: new Date(),
      });
      return true;
    });
    if (done) {
      failed += 1;
      log.warn({ runId: row.id }, 'assistant.run.not-started');
    }
  }
  return failed;
}

/** Decided approvals whose decision Restate has not accepted yet. */
async function approvalsToHandOver(db: AssistantDatabase): Promise<string[]> {
  const rows = await db
    .select({ id: assistantApprovalTable.id })
    .from(assistantApprovalTable)
    .where(
      and(
        inArray(assistantApprovalTable.status, ['approved', 'declined', 'cancelled']),
        isNull(assistantApprovalTable.resolutionHandedOverAt),
        lt(assistantApprovalTable.decidedAt, new Date(Date.now() - SWEEP_GRACE_MS)),
      ),
    )
    .orderBy(asc(assistantApprovalTable.decidedAt))
    .limit(SWEEP_LIMIT);
  return rows.map((row) => row.id);
}

/**
 * One outbox sweep, safe across API replicas and bounded per kind. A
 * replica sending the same row again joins one Restate invocation (same
 * idempotency key), and every write is conditional on the row still being
 * owed, so overlapping sweeps change nothing twice.
 */
export async function sweepAssistantOutbox(db: AssistantDatabase = defaultDb) {
  const runs = await claimRunsToHandOver(db);
  let runsSent = 0;
  for (const runId of runs.toSend) if (await handOverRun(runId, db)) runsSent += 1;
  const runsNotStarted = await failUnstartedRuns(db);
  const approvals = await approvalsToHandOver(db);
  let approvalsSent = 0;
  for (const approvalId of approvals) if (await handOverApprovalResolution(approvalId, db)) approvalsSent += 1;
  return {
    runs: runs.toSend.length,
    runsSent,
    runsExpired: runs.expired,
    runsNotStarted,
    approvals: approvals.length,
    approvalsSent,
  };
}
