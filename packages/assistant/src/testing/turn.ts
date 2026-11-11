import { randomUUID } from 'node:crypto';

import type { AssistantStreamEvent } from '@campuspilot/assistant-contract/dto';
import { asc, eq } from 'drizzle-orm';
import { expect, vi } from 'vitest';

import { db } from '../db';
import {
  assistantApprovalTable,
  assistantItemTable,
  assistantTranscriptEntryTable,
  type AssistantToolCallBody,
} from '@campuspilot/db/schema/assistant';
import { publishAssistantEvent, subscribeAssistantEvents } from '../events';
import { stopRun } from '../run-stop';
import { generateId } from '../ids';
import type { ProcessRunInput } from '../runtime/contract';
import type { ModelProviderId } from '../runtime/providers/types';
import type { AssistantTool, AssistantToolCatalog, ToolOutcome } from '../runtime/tools';
import * as store from '../store';
import { userMessageItemKey } from '../transcript';
import type { FakeRunContext } from './run-context';
import { createTestSchool } from './school';

/**
 * Helpers for tests that drive a turn against the real store, Postgres and
 * Redis. They stand in for the parts of the service a turn test does not
 * run: the router (which saves the message and starts the run, and later
 * resolves approvals and stops) and the API's tool listing.
 */

export type SeededTurn = {
  conversationId: string;
  runId: string;
  schoolId: string;
  userId: string;
  /** What the router hands the Restate handler for this run. */
  input: ProcessRunInput;
};

/**
 * Saves a conversation, a queued run and its user message, the way the
 * router's `sendMessage` does, through the same store functions.
 */
export async function seedTurn({
  text = 'How many students are in class 5?',
  provider = 'anthropic',
  conversationModel = 'conversation-start-model',
  schoolId: givenSchoolId,
}: {
  text?: string;
  /** The school to seed the turn in; a new one when omitted. */
  schoolId?: string;
  /** The provider the conversation is recorded on. */
  provider?: ModelProviderId;
  /** The model the conversation started on (`assistant_conversation.model`). */
  conversationModel?: string;
} = {}): Promise<SeededTurn> {
  const conversationId = generateId('conversation');
  const runId = generateId('run');
  const schoolId = givenSchoolId ?? (await createTestSchool());
  const userId = `usr_${randomUUID()}`;
  await store.assistantTransaction(db, async (tx, emit) => {
    await store.createConversation(tx, {
      id: conversationId,
      schoolId,
      userId,
      title: text,
      provider,
      model: conversationModel,
    });
    await store.insertRun(tx, emit, {
      id: runId,
      conversationId,
      schoolId,
      userId,
      clientRequestId: randomUUID(),
      surface: 'panel',
    });
    await store.insertItem(tx, emit, {
      conversationId,
      runId,
      kind: 'user_message',
      status: 'complete',
      body: { text },
      itemKey: userMessageItemKey(runId),
    });
  });
  return {
    conversationId,
    runId,
    schoolId,
    userId,
    input: { runId, user: { name: 'Asha Rao', email: 'asha.rao@school.test' } },
  };
}

/** Everything a turn left in the database, in display and model order. */
export async function readTurn(turn: Pick<SeededTurn, 'conversationId' | 'runId'>) {
  const [run, items, transcript, approvals] = await Promise.all([
    store.findRun(db, turn.runId),
    db
      .select()
      .from(assistantItemTable)
      .where(eq(assistantItemTable.conversationId, turn.conversationId))
      .orderBy(asc(assistantItemTable.position)),
    db
      .select()
      .from(assistantTranscriptEntryTable)
      .where(eq(assistantTranscriptEntryTable.conversationId, turn.conversationId))
      .orderBy(asc(assistantTranscriptEntryTable.position)),
    db
      .select()
      .from(assistantApprovalTable)
      .where(eq(assistantApprovalTable.runId, turn.runId))
      .orderBy(asc(assistantApprovalTable.createdAt)),
  ]);
  if (!run) throw new Error(`Run ${turn.runId} does not exist.`);
  return {
    run,
    items,
    /** The tool calls among the items, with their bodies typed. */
    toolCalls: items
      .filter((item) => item.kind === 'tool_call')
      .map((item) => ({ ...item, body: item.body as AssistantToolCallBody })),
    transcript: transcript.map(({ role, content, entryKey }) => ({ role, content, entryKey })),
    approvals,
  };
}

type PublishedEvent = Exclude<AssistantStreamEvent, { type: 'snapshot' | 'heartbeat' }>;

/**
 * Collects what a conversation's subscribers are sent, through the service's
 * own Redis subscription. Open it before the turn starts.
 */
export async function watchEvents(conversationId: string) {
  const subscription = await subscribeAssistantEvents(conversationId);
  const received: AssistantStreamEvent[] = [];
  void (async () => {
    for (let event = await subscription.next(); event; event = await subscription.next()) {
      received.push(event);
    }
  })();
  const markers = () => received.filter((event) => event.type === 'heartbeat').length;

  return {
    /**
     * Every event published so far. Pub/sub delivers asynchronously, so this
     * publishes a marker (a heartbeat, which a turn never sends) on the same
     * connection the service publishes on and waits for it: Redis keeps one
     * connection's messages in order, so everything before it has arrived.
     */
    async published(): Promise<PublishedEvent[]> {
      const before = markers();
      await publishAssistantEvent(conversationId, { type: 'heartbeat' });
      await vi.waitFor(() => expect(markers()).toBeGreaterThan(before), { timeout: 5_000 });
      return received.filter((event): event is PublishedEvent => event.type !== 'heartbeat');
    },
    close: () => subscription.close(),
  };
}

/**
 * Waits until the run asks for an approval and returns it. Fails at once if
 * the turn ends first, instead of timing out.
 */
export async function waitForPendingApproval(turn: Pick<SeededTurn, 'runId'>, running: Promise<unknown>) {
  let ended: string | null = null;
  running.then(
    () => (ended = 'ended'),
    (error: unknown) => (ended = `failed: ${String(error)}`),
  );
  return vi.waitFor(
    async () => {
      const approval = await store.findPendingApprovalForRun(db, turn.runId);
      if (approval) return approval;
      if (ended) throw new Error(`The turn ${ended} without asking for approval.`);
      throw new Error('No approval is pending yet.');
    },
    { timeout: 10_000, interval: 20 },
  );
}

/**
 * Waits for a turn that must end without asking the user anything. Fails as
 * soon as an approval appears, instead of hanging on it until the test
 * times out.
 */
export async function finishWithoutApproval(turn: Pick<SeededTurn, 'runId'>, running: Promise<unknown>) {
  let settled = false;
  const outcome = running.finally(() => (settled = true));
  // Observed here so a rejection is reported by the `await` below, not as unhandled.
  outcome.catch(() => {});
  while (!settled) {
    if (await store.findPendingApprovalForRun(db, turn.runId)) {
      throw new Error('The turn asked for an approval; it was expected to end without one.');
    }
    await Promise.race([outcome.catch(() => {}), new Promise((resolve) => setTimeout(resolve, 20))]);
  }
  await outcome;
}

/**
 * The user's decision on a pending approval, as the router's
 * `respondToApproval` applies it: the approval row is decided, then the
 * run's awakeable is resolved with the decision.
 */
export async function respondToApproval(
  ctx: FakeRunContext,
  approval: store.ApprovalRow,
  decision: 'approve' | 'decline',
) {
  const decided = await store.decideApproval(db, approval.id, decision === 'approve' ? 'approved' : 'declined');
  if (!decided) throw new Error(`Approval ${approval.id} was already decided.`);
  ctx.resolveAwakeable(decided.awakeableId, { decision });
}

/**
 * The user's stop, through the same `stopRun` the router uses. The worker's
 * hand-over is stood in for by the fake run context: the cancelled
 * approval's awakeable is resolved with the decision saved on the row, as
 * `AssistantControl.resolveApproval` does.
 */
export async function requestStop(ctx: FakeRunContext | null, turn: Pick<SeededTurn, 'runId'>) {
  const run = await store.findRun(db, turn.runId);
  if (!run) throw new Error(`Run ${turn.runId} does not exist.`);
  await stopRun(run, async (approvalId) => {
    if (!ctx) throw new Error('A run context is needed to cancel a pending approval.');
    const approval = await store.findApproval(db, approvalId);
    if (!approval) throw new Error(`Approval ${approvalId} does not exist.`);
    ctx.resolveAwakeable(approval.awakeableId, { decision: 'cancel' });
  });
}

/** A CampusPilot tool as the API's MCP listing would describe it. */
export function mcpTool(mcpName: string, access: 'read' | 'write', overrides: Partial<AssistantTool> = {}): AssistantTool {
  return {
    source: 'mcp',
    modelName: mcpName.replaceAll('.', '_'),
    mcpName,
    title: `Title of ${mcpName}`,
    description: `Description of ${mcpName}.`,
    inputSchema: { type: 'object', properties: {} },
    readOnly: access === 'read',
    destructive: false,
    exposure: 'core',
    module: 'students',
    ...overrides,
  };
}

export function catalogOf(...tools: AssistantTool[]): AssistantToolCatalog {
  return { tools: new Map(tools.map((tool) => [tool.modelName, tool])), ordered: tools };
}

/**
 * A successful tool outcome. The copy the model reads and the copy stored on
 * the item are different strings on purpose, so a test can tell which one
 * went where.
 */
export function toolSuccess(text: string): Extract<ToolOutcome, { ok: true }> {
  return {
    ok: true,
    text,
    modelContent: `${text} [as the model reads it]`,
    storedOutput: `${text} [as stored on the item]`,
    outputTruncated: false,
  };
}
