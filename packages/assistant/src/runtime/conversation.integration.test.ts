import { assistantModelRequestTable } from '@campuspilot/db/schema/assistant';
import { createLogger } from '@campuspilot/logger';
import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { db } from '../db';
import * as store from '../store';
import { getRunToken } from '../run-token';
import { createFakeRunContext, SimulatedCrash, type FakeRunContext } from '../testing/run-context';
import {
  catalogOf,
  finishWithoutApproval,
  mcpTool,
  readTurn,
  requestStop,
  respondToApproval,
  seedTurn,
  toolSuccess,
  waitForPendingApproval,
  watchEvents,
} from '../testing/turn';
import {
  interruptedTranscriptKey,
  modelTranscriptKey,
  toolResultsTranscriptKey,
  userTranscriptKey,
} from '../transcript';
import {
  createRunProcessor,
  MAX_MODEL_STEPS,
  MODEL_STEP_RETRY,
  RECOVERED_OUTPUT_CUT_NOTE,
  type RunAccessCheck,
} from './conversation';
import {
  createFakeProvider,
  FAKE_PRICES,
  FAKE_REPORTED_MODEL,
  FAKE_USAGE,
  FakeModelError,
  fakeProviderRegistry,
  fakeReply,
  fakeStreamed,
  type FakeModelCall,
  type FakeModelStep,
  type FakeToolResultBlock,
} from './providers/fake';
import { withBilledUsage } from './providers/types';
import { callTool, loadToolCatalog } from './tools';

/**
 * The durable turn loop (`processRun`) against the real store, Postgres and
 * Redis. Only three things are replaced:
 * - the model: a scripted fake provider (providers/fake.ts);
 * - Restate: a fake run context that retries, journals and replays steps
 *   (testing/run-context.ts);
 * - the CampusPilot API: `callTool`/`loadToolCatalog` (its MCP endpoint) and
 *   `getRunToken` (the delegated token it issued).
 */
vi.mock('./tools', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tools')>()),
  callTool: vi.fn(),
  loadToolCatalog: vi.fn(),
}));
/**
 * A hook that runs once, inside the transaction that creates an approval,
 * just before the approval row is written: the moment a Stop must not slip
 * through. Everything else in the store is real.
 */
const beforeApprovalInsert = vi.hoisted(() => ({ current: null as null | (() => Promise<void>) }));
vi.mock('../store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store')>();
  return {
    ...actual,
    insertApproval: async (...args: Parameters<typeof actual.insertApproval>) => {
      const hook = beforeApprovalInsert.current;
      beforeApprovalInsert.current = null;
      await hook?.();
      return actual.insertApproval(...args);
    },
  };
});
vi.mock('../run-token', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../run-token')>()),
  getRunToken: vi.fn(),
}));

const callToolMock = vi.mocked(callTool);
const loadToolCatalogMock = vi.mocked(loadToolCatalog);
const getRunTokenMock = vi.mocked(getRunToken);

const TOKEN = 'delegated-run-token-for-tests';
const QUESTION = 'Rename student stu_1 to Asha R.';

const listStudents = mcpTool('students.list', 'read');
const updateStudent = mcpTool('students.update', 'write');

/** Attempts of one model request, the first included (Restate counts it). */
const MODEL_STEP_ATTEMPTS = MODEL_STEP_RETRY.maxRetryAttempts;

const log = createLogger({ pkg: 'assistant-test' });

beforeEach(() => {
  callToolMock.mockReset().mockImplementation(async (_token, tool) => {
    throw new Error(`Unexpected call of ${tool.mcpName}.`);
  });
  loadToolCatalogMock.mockReset().mockResolvedValue(catalogOf(listStudents, updateStudent));
  getRunTokenMock.mockReset().mockResolvedValue(TOKEN);
});

/** Saves a turn's rows, subscribes to its events and builds its processor. */
async function arrange({
  script = [],
  whenExhausted,
  providerModel = 'configured-model',
  conversationModel = 'conversation-start-model',
  configured = true,
  checkAccess = async () => ({ allowed: true as const }),
}: {
  script?: FakeModelStep[];
  whenExhausted?: FakeModelStep;
  providerModel?: string;
  conversationModel?: string;
  /** False when the conversation's provider is no longer configured. */
  configured?: boolean;
  /** The worker's access check before each model request (allows by default). */
  checkAccess?: RunAccessCheck;
} = {}) {
  const provider = createFakeProvider({ model: providerModel, script, whenExhausted });
  const turn = await seedTurn({ text: QUESTION, provider: provider.id, conversationModel });
  const events = await watchEvents(turn.conversationId);
  onTestFinished(() => events.close());
  const processRun = createRunProcessor({ providers: fakeProviderRegistry(configured ? provider : null), log, checkAccess });
  /** Invokes the handler, as Restate does; pass a context with a journal to replay. */
  const invoke = (ctx: FakeRunContext = createFakeRunContext()) => ({ ctx, done: processRun(ctx, turn.input) });
  return { provider, turn, events, invoke };
}

/** The cost rows a run saved, in the order its requests were made. */
const modelRequestsOf = (runId: string) =>
  db
    .select()
    .from(assistantModelRequestTable)
    .where(eq(assistantModelRequestTable.runId, runId))
    .orderBy(asc(assistantModelRequestTable.requestKey));

/** The tool results a model request was given: its transcript's last entry. */
const toolResultsSentTo = (call: FakeModelCall | undefined) =>
  (call?.transcript.at(-1)?.content ?? []) as FakeToolResultBlock[];

/** Consecutive duplicates removed: the changes a value went through. */
const changes = <T>(values: T[]) => values.filter((value, index) => index === 0 || value !== values[index - 1]);

const writeCall = { id: 'tu_write', name: updateStudent.modelName, input: { studentId: 'stu_1', name: 'Asha R.' } };
const readCall = { id: 'tu_read', name: listStudents.modelName, input: { page: 1 } };

describe('a text-only reply', () => {
  it('completes, and records the model the provider reported rather than the conversation’s', async () => {
    const reply = 'Hello Asha.\nHow can I help?\n';
    const { provider, turn, events, invoke } = await arrange({
      script: [fakeStreamed(['Hello Asha.\n', reply], fakeReply({ text: reply, model: 'reported-model-20261101' }))],
      providerModel: 'configured-model',
      conversationModel: 'conversation-start-model',
    });

    await invoke().done;

    const { run, items, transcript, approvals } = await readTurn(turn);
    expect(run).toMatchObject({
      status: 'completed',
      errorCode: null,
      errorMessage: null,
      errorDetail: null,
      stopRequestedAt: null,
      provider: 'anthropic',
      model: 'reported-model-20261101',
      modelRequestCount: 1,
      inputTokens: FAKE_USAGE.inputTokens,
      outputTokens: FAKE_USAGE.outputTokens,
      cacheReadInputTokens: FAKE_USAGE.cacheReadInputTokens,
      cacheCreationInputTokens: FAKE_USAGE.cacheCreationInputTokens,
    });
    expect(run.startedAt).toBeInstanceOf(Date);
    expect(run.completedAt).toBeInstanceOf(Date);
    expect(items.map(({ kind, status, body }) => ({ kind, status, body }))).toEqual([
      { kind: 'user_message', status: 'complete', body: { text: QUESTION } },
      { kind: 'assistant_message', status: 'complete', body: { text: reply } },
    ]);
    expect(transcript).toEqual([
      { role: 'user', entryKey: userTranscriptKey(turn.runId), content: [{ type: 'text', text: QUESTION }] },
      { role: 'assistant', entryKey: modelTranscriptKey(turn.runId, 0), content: [{ type: 'text', text: reply }] },
    ]);
    expect(approvals).toEqual([]);
    expect(callToolMock).not.toHaveBeenCalled();

    // What the model was asked: the user's message, every catalog tool, the facts.
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toMatchObject({
      toolNames: [listStudents.modelName, updateStudent.modelName],
      transcript: [{ role: 'user', content: [{ type: 'text', text: QUESTION }] }],
    });
    expect(provider.calls[0]?.prompt.facts).toContain('Asha Rao <asha.rao@school.test>');
    expect(provider.calls[0]?.prompt.facts).toContain(turn.schoolId);

    // What subscribers were told.
    const published = await events.published();
    const runs = published.flatMap((event) => (event.type === 'run' ? [event.run] : []));
    expect(runs.map((r) => [r.status, r.diagnostics?.model])).toEqual([
      ['running', 'configured-model'],
      ['running', 'reported-model-20261101'],
      ['completed', 'reported-model-20261101'],
    ]);
    expect(runs.at(-1)?.diagnostics).toMatchObject({ modelRequestCount: 1, ...FAKE_USAGE, errorDetail: null });
    const message = items[1]!;
    const itemEvents = published.flatMap((event) => (event.type === 'item' ? [event.item] : []));
    expect(itemEvents.map((item) => [item.id, item.status])).toEqual([
      [message.id, 'streaming'],
      [message.id, 'complete'],
    ]);
    // Sequenced changes reach subscribers in order.
    const sequences = published.flatMap((event) =>
      event.type === 'run' ? [event.run.sequence] : event.type === 'item' ? [event.item.sequence] : [],
    );
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(new Set(sequences).size).toBe(sequences.length);
    // The streamed text, line by line. Text frames are published off the
    // step's main path, so they may land a moment after the run completes.
    await vi.waitFor(async () => {
      const texts = (await events.published()).flatMap((event) => (event.type === 'text' ? [event] : []));
      expect(texts).toEqual([
        { type: 'text', itemId: message.id, offset: 0, delta: 'Hello Asha.\n' },
        { type: 'text', itemId: message.id, offset: 'Hello Asha.\n'.length, delta: 'How can I help?\n' },
      ]);
    });
  });

  it('names the school in the prompt when the API lists it', async () => {
    const listMySchools = mcpTool('school.listMySchools', 'read', { module: 'schools' });
    loadToolCatalogMock.mockResolvedValue(catalogOf(listMySchools, listStudents));
    const { provider, turn, invoke } = await arrange({ script: [fakeReply({ text: 'Hi.' })] });
    callToolMock.mockResolvedValueOnce(
      toolSuccess(JSON.stringify([{ id: 'sch_other', name: 'Other School' }, { id: turn.schoolId, name: 'Maple High' }])),
    );

    await invoke().done;

    expect(callToolMock).toHaveBeenCalledExactlyOnceWith(TOKEN, listMySchools, {});
    expect(provider.calls[0]?.prompt.facts).toContain(`School: Maple High (schoolId: ${turn.schoolId})`);
    expect((await readTurn(turn)).run.status).toBe('completed');
  });
});

describe('a read tool call', () => {
  it('runs without approval and its result reaches the next model step', async () => {
    const { provider, turn, events, invoke } = await arrange({
      script: [fakeReply({ toolUses: [readCall] }), fakeReply({ text: 'There are 2 students.', model: 'second-model' })],
    });
    const outcome = toolSuccess('[{"id":"stu_1"},{"id":"stu_2"}]');
    callToolMock.mockResolvedValueOnce(outcome);

    const { ctx, done } = invoke();
    await done;

    expect(callToolMock).toHaveBeenCalledExactlyOnceWith(TOKEN, listStudents, readCall.input);
    expect(ctx.pendingAwakeables()).toEqual([]);

    const { run, items, toolCalls, transcript, approvals } = await readTurn(turn);
    expect(approvals).toEqual([]);
    expect(run).toMatchObject({
      status: 'completed',
      errorCode: null,
      model: 'second-model',
      modelRequestCount: 2,
      inputTokens: 2 * FAKE_USAGE.inputTokens,
      outputTokens: 2 * FAKE_USAGE.outputTokens,
      cacheReadInputTokens: 2 * FAKE_USAGE.cacheReadInputTokens,
      cacheCreationInputTokens: 2 * FAKE_USAGE.cacheCreationInputTokens,
    });
    expect(items.map((item) => [item.kind, item.status])).toEqual([
      ['user_message', 'complete'],
      ['tool_call', 'succeeded'],
      ['assistant_message', 'complete'],
    ]);
    expect(toolCalls[0]?.body).toEqual({
      toolUseId: readCall.id,
      toolName: listStudents.mcpName,
      title: listStudents.title,
      access: 'read',
      destructive: false,
      module: listStudents.module,
      input: readCall.input,
      output: outcome.storedOutput,
      outputTruncated: false,
    });

    // The model's second request ends with the result, in the copy cut for the model.
    const result = { type: 'tool_result', toolUseId: readCall.id, toolName: readCall.name, content: outcome.modelContent, isError: false };
    expect(provider.calls).toHaveLength(2);
    expect(toolResultsSentTo(provider.calls[1])).toEqual([result]);
    expect(transcript.map(({ role, entryKey }) => [role, entryKey])).toEqual([
      ['user', userTranscriptKey(turn.runId)],
      ['assistant', modelTranscriptKey(turn.runId, 0)],
      ['user', toolResultsTranscriptKey(turn.runId, 0)],
      ['assistant', modelTranscriptKey(turn.runId, 1)],
    ]);
    expect(transcript[1]?.content).toEqual([{ type: 'tool_use', ...readCall }]);
    expect(transcript[2]?.content).toEqual([result]);

    const published = await events.published();
    const runStatuses = published.flatMap((event) => (event.type === 'run' ? [event.run.status] : []));
    expect(changes(runStatuses)).toEqual(['running', 'completed']);
    const callStatuses = published.flatMap((event) =>
      event.type === 'item' && event.item.kind === 'tool_call' ? [event.item.status] : [],
    );
    expect(changes(callStatuses)).toEqual(['running', 'succeeded']);
  });

  it('is called again when its step is retried', async () => {
    const { provider, turn, invoke } = await arrange({
      script: [fakeReply({ toolUses: [readCall] }), fakeReply({ text: 'Done.' })],
    });
    const outcome = toolSuccess('[]');
    callToolMock.mockRejectedValueOnce(new Error('fetch failed')).mockResolvedValueOnce(outcome);

    const { ctx, done } = invoke();
    await done;

    expect(callToolMock).toHaveBeenCalledTimes(2);
    expect(ctx.attempts(`tool-${readCall.id}`)).toBe(2);
    const { run, toolCalls } = await readTurn(turn);
    expect(run.status).toBe('completed');
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({ status: 'succeeded', body: { output: outcome.storedOutput } });
    // Repeating a read is harmless, so nothing marks it as started.
    expect(toolCalls[0]?.body.executionStartedAt).toBeUndefined();
    expect(toolResultsSentTo(provider.calls[1])).toMatchObject([{ content: outcome.modelContent, isError: false }]);
  });

  it('for a tool the catalog does not list is answered with NOT_FOUND and never run', async () => {
    const unknownCall = { id: 'tu_unknown', name: 'students_delete', input: {} };
    const { provider, turn, invoke } = await arrange({
      script: [fakeReply({ toolUses: [unknownCall] }), fakeReply({ text: 'I cannot do that.' })],
    });

    await invoke().done;

    expect(callToolMock).not.toHaveBeenCalled();
    const [result] = toolResultsSentTo(provider.calls[1]);
    expect(result).toMatchObject({ toolUseId: unknownCall.id, isError: true });
    expect(JSON.parse(result!.content)).toMatchObject({ code: 'NOT_FOUND' });
    const { run, toolCalls } = await readTurn(turn);
    expect(run.status).toBe('completed');
    expect(toolCalls).toEqual([]);
  });
});

describe('a write tool call', () => {
  const script = () => [
    fakeReply({ text: 'I will rename the student.', toolUses: [writeCall] }),
    fakeReply({ text: 'Renamed.' }),
  ];

  it('waits for approval, then runs exactly once with the arguments that were shown', async () => {
    const { provider, turn, events, invoke } = await arrange({ script: script() });
    const { ctx, done } = invoke();

    const approval = await waitForPendingApproval(turn, done);
    const waiting = await readTurn(turn);
    const shown = waiting.toolCalls[0]!;
    expect(waiting.run.status).toBe('awaiting_approval');
    expect(waiting.toolCalls).toHaveLength(1);
    expect(shown).toMatchObject({
      status: 'awaiting_approval',
      body: {
        toolUseId: writeCall.id,
        toolName: updateStudent.mcpName,
        access: 'write',
        input: writeCall.input,
        approvalId: approval.id,
      },
    });
    expect(approval).toMatchObject({
      status: 'pending',
      itemId: shown.id,
      conversationId: turn.conversationId,
      schoolId: turn.schoolId,
      userId: turn.userId,
      toolName: writeCall.name,
    });
    expect(ctx.pendingAwakeables()).toEqual([approval.awakeableId]);
    // Nothing ran and the model was not asked again while the user decides.
    expect(callToolMock).not.toHaveBeenCalled();
    expect(provider.calls).toHaveLength(1);

    const outcome = toolSuccess('{"id":"stu_1","name":"Asha R."}');
    callToolMock.mockResolvedValueOnce(outcome);
    await respondToApproval(ctx, approval, 'approve');
    await done;

    expect(callToolMock).toHaveBeenCalledExactlyOnceWith(TOKEN, updateStudent, shown.body.input);

    const { run, items, toolCalls, approvals } = await readTurn(turn);
    expect(run).toMatchObject({ status: 'completed', errorCode: null, modelRequestCount: 2 });
    expect(items.map((item) => [item.kind, item.status])).toEqual([
      ['user_message', 'complete'],
      ['assistant_message', 'complete'],
      ['tool_call', 'succeeded'],
      ['assistant_message', 'complete'],
    ]);
    expect(toolCalls[0]?.body).toMatchObject({ output: outcome.storedOutput, approvalId: approval.id });
    expect(toolCalls[0]?.body.executionStartedAt).toEqual(expect.any(String));
    expect(approvals.map((row) => row.status)).toEqual(['approved']);
    expect(toolResultsSentTo(provider.calls[1])).toEqual([
      { type: 'tool_result', toolUseId: writeCall.id, toolName: writeCall.name, content: outcome.modelContent, isError: false },
    ]);

    const published = await events.published();
    expect(changes(published.flatMap((event) => (event.type === 'run' ? [event.run.status] : [])))).toEqual([
      'running',
      'awaiting_approval',
      'running',
      'completed',
    ]);
    expect(
      changes(
        published.flatMap((event) =>
          event.type === 'item' && event.item.kind === 'tool_call' ? [event.item.status] : [],
        ),
      ),
    ).toEqual(['awaiting_approval', 'running', 'succeeded']);
  });

  it('is never called when the user declines, and the model is told so', async () => {
    const { provider, turn, invoke } = await arrange({ script: script() });
    const { ctx, done } = invoke();

    const approval = await waitForPendingApproval(turn, done);
    await respondToApproval(ctx, approval, 'decline');
    await done;

    expect(callToolMock).not.toHaveBeenCalled();
    const { run, toolCalls, approvals } = await readTurn(turn);
    expect(run).toMatchObject({ status: 'completed', errorCode: null, modelRequestCount: 2 });
    expect(toolCalls.map((call) => call.status)).toEqual(['declined']);
    expect(toolCalls[0]?.body.executionStartedAt).toBeUndefined();
    expect(toolCalls[0]?.body.output).toBeUndefined();
    expect(approvals.map((row) => row.status)).toEqual(['declined']);
    expect(provider.calls).toHaveLength(2);
    expect(toolResultsSentTo(provider.calls[1])).toEqual([
      {
        type: 'tool_result',
        toolUseId: writeCall.id,
        toolName: writeCall.name,
        content: expect.stringMatching(/declined/i),
        isError: true,
      },
    ]);
  });

  it('is never left waiting when the stop lands while its approval is being created', async () => {
    const { turn, invoke } = await arrange({
      script: [fakeReply({ toolUses: [writeCall] }), fakeReply({ text: 'never requested' })],
    });
    const { ctx, done } = invoke();
    let stopping: Promise<void> | null = null;
    beforeApprovalInsert.current = async () => {
      stopping = requestStop(ctx, turn);
      // Give the stop the time to finish if nothing holds it back. With the
      // run's row locked here, it waits for this transaction instead.
      await Promise.race([stopping, new Promise((resolve) => setTimeout(resolve, 300))]);
    };

    await vi.waitFor(async () => expect((await readTurn(turn)).run.status).toBe('cancelled'), { timeout: 5_000 });
    await stopping;
    await done;

    expect(callToolMock).not.toHaveBeenCalled();
    const { approvals, toolCalls } = await readTurn(turn);
    expect(approvals.map((row) => row.status)).toEqual(['cancelled']);
    expect(toolCalls.map((call) => call.status)).toEqual(['cancelled']);
  });

  it('is never called when the run is stopped while it waits, and the run ends cancelled', async () => {
    // The read after the write must not run either once the run is stopped.
    const { provider, turn, events, invoke } = await arrange({
      script: [fakeReply({ toolUses: [writeCall, readCall] }), fakeReply({ text: 'never requested' })],
    });
    const { ctx, done } = invoke();

    await waitForPendingApproval(turn, done);
    await requestStop(ctx, turn);
    await done;

    expect(callToolMock).not.toHaveBeenCalled();
    expect(provider.calls).toHaveLength(1);
    const { run, toolCalls, approvals, transcript } = await readTurn(turn);
    expect(run).toMatchObject({ status: 'cancelled', errorCode: null, errorMessage: null, modelRequestCount: 1 });
    expect(run.stopRequestedAt).toBeInstanceOf(Date);
    expect(run.completedAt).toBeInstanceOf(Date);
    expect(toolCalls.map((call) => [call.body.toolUseId, call.status])).toEqual([[writeCall.id, 'cancelled']]);
    expect(approvals.map((row) => row.status)).toEqual(['cancelled']);
    // Both calls are answered, so the conversation can be continued later.
    expect(transcript.at(-1)).toEqual({
      role: 'user',
      entryKey: toolResultsTranscriptKey(turn.runId, 0),
      content: [writeCall, readCall].map((call) => ({
        type: 'tool_result',
        toolUseId: call.id,
        toolName: call.name,
        content: expect.stringMatching(/stopped/i),
        isError: true,
      })),
    });

    const published = await events.published();
    expect(changes(published.flatMap((event) => (event.type === 'run' ? [event.run.status] : [])))).toEqual([
      'running',
      'awaiting_approval',
      'cancelled',
    ]);
  });

  it('is not handed to the API when a stop lands after the approval was decided', async () => {
    const { turn, invoke } = await arrange({
      script: [fakeReply({ toolUses: [writeCall] }), fakeReply({ text: 'never requested' })],
    });
    const { ctx, done } = invoke();

    const approval = await waitForPendingApproval(turn, done);
    // The approve committed first; the stop then finds no pending approval.
    const decided = await store.decideApproval(db, approval.id, 'approved');
    await requestStop(ctx, turn);
    ctx.resolveAwakeable(decided!.awakeableId, { decision: 'approve' });
    await done;

    expect(callToolMock).not.toHaveBeenCalled();
    const { run, toolCalls } = await readTurn(turn);
    expect(run).toMatchObject({ status: 'cancelled', errorCode: null });
    expect(toolCalls.map((call) => [call.status, call.body.executionStartedAt])).toEqual([['cancelled', undefined]]);
  });

  it('fails with NOT_FOUND, without crashing the run, when the tool left the catalog before its approved call ran', async () => {
    const { provider, turn, invoke } = await arrange({ script: script() });
    const { ctx, done } = invoke();

    const approval = await waitForPendingApproval(turn, done);
    // The API stops offering the tool while the user decides.
    loadToolCatalogMock.mockResolvedValue(catalogOf(listStudents));
    await respondToApproval(ctx, approval, 'approve');
    await done;

    expect(callToolMock).not.toHaveBeenCalled();
    const { run, toolCalls } = await readTurn(turn);
    expect(run).toMatchObject({ status: 'completed', errorCode: null, modelRequestCount: 2 });
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({ status: 'failed', body: { error: { code: 'NOT_FOUND' } } });
    const [result] = toolResultsSentTo(provider.calls[1]);
    expect(result).toMatchObject({ toolUseId: writeCall.id, isError: true });
    expect(JSON.parse(result!.content)).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('at-most-once writes', () => {
  const script = () => [fakeReply({ toolUses: [writeCall] }), fakeReply({ text: 'Renamed.' })];

  it.each([
    ['whole', false, ''],
    ['cut short, with a note saying so', true, `\n${RECOVERED_OUTPUT_CUT_NOTE}`],
  ])('does not call the tool again when its step is replayed after the call succeeded, and reports the recorded output (%s)', async (_label, outputTruncated, note) => {
    const { provider, turn, invoke } = await arrange({ script: script() });
    const outcome = { ...toolSuccess('{"id":"stu_1","name":"Asha R."}'), outputTruncated };
    callToolMock.mockResolvedValueOnce(outcome);

    // First invocation: the write is approved and applied, then the service
    // dies before Restate records the step's result.
    const first = invoke();
    first.ctx.crashAfter(`tool-${writeCall.id}`);
    const approval = await waitForPendingApproval(turn, first.done);
    await respondToApproval(first.ctx, approval, 'approve');
    await expect(first.done).rejects.toBeInstanceOf(SimulatedCrash);
    expect(callToolMock).toHaveBeenCalledTimes(1);
    expect(first.ctx.journal.some((entry) => entry.kind === 'run' && entry.name === `tool-${writeCall.id}`)).toBe(false);

    // Restate invokes the handler again with the journal it has.
    const replay = invoke(createFakeRunContext({ journal: first.ctx.journal }));
    await replay.done;

    // Finished steps came from the journal; only the interrupted one ran again.
    expect(replay.ctx.replayed).toEqual([
      'begin',
      'model-0',
      `tool-prepare-${writeCall.id}`,
      `approval-request-${writeCall.id}`,
      `approval-result-${writeCall.id}`,
    ]);
    expect(replay.ctx.executed[0]).toBe(`tool-${writeCall.id}`);
    expect(callToolMock).toHaveBeenCalledTimes(1);
    expect(provider.calls).toHaveLength(2);
    expect(toolResultsSentTo(provider.calls[1])).toEqual([
      { type: 'tool_result', toolUseId: writeCall.id, toolName: writeCall.name, content: `${outcome.storedOutput}${note}`, isError: false },
    ]);

    const { run, toolCalls, approvals } = await readTurn(turn);
    expect(run).toMatchObject({ status: 'completed', errorCode: null, modelRequestCount: 2 });
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({ status: 'succeeded', body: { output: outcome.storedOutput } });
    expect(approvals).toHaveLength(1);
  });

  it('does not call the tool again when the service restarted mid-call, and reports the outcome as unknown', async () => {
    const { provider, turn, invoke } = await arrange({ script: script() });
    // The call is sent and never answers: the process is gone before it returns.
    callToolMock.mockImplementationOnce(() => new Promise<never>(() => {}));

    const first = invoke();
    const approval = await waitForPendingApproval(turn, first.done);
    await respondToApproval(first.ctx, approval, 'approve');
    await vi.waitFor(() => expect(callToolMock).toHaveBeenCalledTimes(1));

    const replay = invoke(createFakeRunContext({ journal: first.ctx.journal }));
    await replay.done;

    expect(callToolMock).toHaveBeenCalledTimes(1);
    const { run, toolCalls } = await readTurn(turn);
    expect(run).toMatchObject({ status: 'completed', errorCode: null });
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({ status: 'failed', body: { error: { code: 'OUTCOME_UNKNOWN' } } });
    const [result] = toolResultsSentTo(provider.calls[1]);
    expect(result).toMatchObject({ toolUseId: writeCall.id, isError: true });
    expect(JSON.parse(result!.content)).toMatchObject({ code: 'OUTCOME_UNKNOWN' });
  });

  it('ends the call failed with OUTCOME_UNKNOWN and does not retry when the connection is lost', async () => {
    const { provider, turn, invoke } = await arrange({ script: script() });
    callToolMock.mockRejectedValue(new Error('socket hang up'));

    const { ctx, done } = invoke();
    const approval = await waitForPendingApproval(turn, done);
    await respondToApproval(ctx, approval, 'approve');
    await done;

    expect(callToolMock).toHaveBeenCalledTimes(1);
    expect(ctx.attempts(`tool-${writeCall.id}`)).toBe(1);
    const { run, toolCalls } = await readTurn(turn);
    expect(run).toMatchObject({ status: 'completed', errorCode: null, modelRequestCount: 2 });
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({ status: 'failed', body: { error: { code: 'OUTCOME_UNKNOWN' } } });
    expect(toolCalls[0]?.body.output).toBeUndefined();
    const [result] = toolResultsSentTo(provider.calls[1]);
    expect(result).toMatchObject({ toolUseId: writeCall.id, isError: true });
    expect(JSON.parse(result!.content)).toMatchObject({ code: 'OUTCOME_UNKNOWN' });
  });

  it('reuses a saved model response instead of asking the model again when its step is replayed', async () => {
    const { provider, turn, invoke } = await arrange({
      script: [fakeReply({ text: 'Looking.', toolUses: [readCall] }), fakeReply({ text: 'Done.' })],
    });
    callToolMock.mockResolvedValueOnce(toolSuccess('[]'));

    const first = invoke();
    first.ctx.crashAfter('model-0');
    await expect(first.done).rejects.toBeInstanceOf(SimulatedCrash);
    expect(provider.calls).toHaveLength(1);

    const replay = invoke(createFakeRunContext({ journal: first.ctx.journal }));
    await replay.done;

    // model-0 ran again, found its saved response, and the turn went on from
    // it: one request per step, counted and shown once.
    expect(replay.ctx.executed[0]).toBe('model-0');
    expect(provider.calls).toHaveLength(2);
    expect(callToolMock).toHaveBeenCalledExactlyOnceWith(TOKEN, listStudents, readCall.input);
    const { run, items } = await readTurn(turn);
    expect(run).toMatchObject({ status: 'completed', modelRequestCount: 2, inputTokens: 2 * FAKE_USAGE.inputTokens });
    // One cost row per request, not per attempt of its step.
    expect(await modelRequestsOf(turn.runId)).toHaveLength(2);
    expect(items.map((item) => [item.kind, item.status])).toEqual([
      ['user_message', 'complete'],
      ['assistant_message', 'complete'],
      ['tool_call', 'succeeded'],
      ['assistant_message', 'complete'],
    ]);
  });
});

describe('a refused model turn', () => {
  it('runs none of the tool calls it carries and saves only its visible text', async () => {
    const refusal = 'I can’t share that.';
    const { provider, turn, invoke } = await arrange({
      script: [fakeReply({ text: refusal, refusal: true, toolUses: [writeCall, readCall] })],
    });

    const { ctx, done } = invoke();
    await finishWithoutApproval(turn, done);

    expect(callToolMock).not.toHaveBeenCalled();
    expect(ctx.pendingAwakeables()).toEqual([]);
    expect(provider.calls).toHaveLength(1);
    const { run, items, toolCalls, approvals, transcript } = await readTurn(turn);
    expect(toolCalls).toEqual([]);
    expect(approvals).toEqual([]);
    expect(transcript).toHaveLength(2);
    expect(transcript[1]).toEqual({
      role: 'assistant',
      entryKey: modelTranscriptKey(turn.runId, 0),
      content: [{ type: 'text', text: refusal }],
    });
    expect(provider.toolUsesOf(transcript[1]!.content)).toEqual([]);
    expect(items.map(({ kind, status, body }) => ({ kind, status, body }))).toEqual([
      { kind: 'user_message', status: 'complete', body: { text: QUESTION } },
      { kind: 'assistant_message', status: 'complete', body: { text: refusal } },
    ]);
    expect(run).toMatchObject({
      status: 'completed',
      errorCode: null,
      modelRequestCount: 1,
      inputTokens: FAKE_USAGE.inputTokens,
    });
  });

  it('shows a message even when the refusal carries no text', async () => {
    const { turn, invoke } = await arrange({ script: [fakeReply({ refusal: true, toolUses: [writeCall] })] });

    await finishWithoutApproval(turn, invoke().done);

    expect(callToolMock).not.toHaveBeenCalled();
    const { run, items, transcript } = await readTurn(turn);
    expect(run.status).toBe('completed');
    const message = items.find((item) => item.kind === 'assistant_message');
    const text = (message?.body as { text: string } | undefined)?.text;
    expect(message?.status).toBe('complete');
    expect(text).toEqual(expect.stringMatching(/\S/));
    expect(transcript[1]?.content).toEqual([{ type: 'text', text }]);
  });
});

describe('provider failures', () => {
  /** A failed run that never got an answer: nothing counted, nothing said. */
  async function expectFailedBeforeAnyAnswer(turn: Awaited<ReturnType<typeof arrange>>['turn']) {
    const { run, items, transcript } = await readTurn(turn);
    expect(run).toMatchObject({
      status: 'failed',
      // No model answered, so the run keeps the model it meant to call.
      model: 'configured-model',
      modelRequestCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    });
    expect(run.completedAt).toBeInstanceOf(Date);
    expect(items.map((item) => item.kind)).toEqual(['user_message']);
    expect(transcript.map((entry) => entry.entryKey)).toEqual([userTranscriptKey(turn.runId)]);
    return run;
  }

  it('fails with model_rejected, without a retry, when the provider rejects the request', async () => {
    const { provider, turn, events, invoke } = await arrange({
      script: [new FakeModelError('rejected', '400 invalid_request_error: prompt is too long')],
    });

    const { ctx, done } = invoke();
    await done;

    expect(provider.calls).toHaveLength(1);
    expect(ctx.attempts('model-0')).toBe(1);
    const run = await expectFailedBeforeAnyAnswer(turn);
    expect(run).toMatchObject({
      errorCode: 'model_rejected',
      errorDetail: '400 invalid_request_error: prompt is too long',
    });
    expect(run.errorMessage).toEqual(expect.stringMatching(/\S/));
    expect(run.errorMessage).not.toContain('invalid_request_error');

    const published = await events.published();
    const last = published.flatMap((event) => (event.type === 'run' ? [event.run] : [])).at(-1);
    expect(last).toMatchObject({
      status: 'failed',
      errorCode: 'model_rejected',
      errorMessage: run.errorMessage,
      diagnostics: { errorDetail: '400 invalid_request_error: prompt is too long' },
    });
  });

  it('fails with provider_unavailable, without a retry, when the key or model is wrong', async () => {
    const { provider, turn, invoke } = await arrange({
      script: [new FakeModelError('unavailable', '401 authentication_error: invalid x-api-key')],
    });

    const { ctx, done } = invoke();
    await done;

    expect(provider.calls).toHaveLength(1);
    expect(ctx.attempts('model-0')).toBe(1);
    const run = await expectFailedBeforeAnyAnswer(turn);
    expect(run).toMatchObject({
      errorCode: 'provider_unavailable',
      errorDetail: '401 authentication_error: invalid x-api-key',
    });
  });

  it('fails with model_busy after the retries when the provider is busy every time, keeping the raw message', async () => {
    const { provider, turn, invoke } = await arrange({
      script: Array.from(
        { length: MODEL_STEP_ATTEMPTS },
        (_, index) => new FakeModelError('busy', `429 rate_limit_error: attempt ${index + 1}`),
      ),
    });

    const { ctx, done } = invoke();
    await done;

    // Every scripted failure was used and no further request was made.
    expect(provider.calls).toHaveLength(MODEL_STEP_ATTEMPTS);
    expect(provider.remaining()).toBe(0);
    expect(ctx.attempts('model-0')).toBe(MODEL_STEP_ATTEMPTS);
    const run = await expectFailedBeforeAnyAnswer(turn);
    expect(run).toMatchObject({
      errorCode: 'model_busy',
      errorDetail: `429 rate_limit_error: attempt ${MODEL_STEP_ATTEMPTS}`,
    });
    expect(run.errorMessage).toEqual(expect.stringMatching(/busy/i));
    expect(run.errorMessage).not.toContain('rate_limit_error');
  });

  it('completes when the provider is busy once and then answers', async () => {
    const { provider, turn, invoke } = await arrange({
      script: [new FakeModelError('busy', '529 overloaded_error'), fakeReply({ text: 'Here you go.' })],
    });

    const { ctx, done } = invoke();
    await done;

    expect(provider.calls).toHaveLength(2);
    expect(ctx.attempts('model-0')).toBe(2);
    const { run, items } = await readTurn(turn);
    // Only the request that was answered is counted.
    expect(run).toMatchObject({
      status: 'completed',
      errorCode: null,
      errorMessage: null,
      errorDetail: null,
      modelRequestCount: 1,
      inputTokens: FAKE_USAGE.inputTokens,
    });
    expect(items.map(({ kind, status, body }) => ({ kind, status, body }))).toEqual([
      { kind: 'user_message', status: 'complete', body: { text: QUESTION } },
      { kind: 'assistant_message', status: 'complete', body: { text: 'Here you go.' } },
    ]);
  });

  it('fails with the generic model_error after the retries when the failure is unknown every time', async () => {
    const { provider, turn, invoke } = await arrange({
      script: Array.from({ length: MODEL_STEP_ATTEMPTS }, (_, index) => new Error(`ECONNRESET on attempt ${index + 1}`)),
    });

    const { ctx, done } = invoke();
    await done;

    expect(provider.calls).toHaveLength(MODEL_STEP_ATTEMPTS);
    expect(provider.remaining()).toBe(0);
    expect(ctx.attempts('model-0')).toBe(MODEL_STEP_ATTEMPTS);
    const run = await expectFailedBeforeAnyAnswer(turn);
    expect(run).toMatchObject({
      errorCode: 'model_error',
      errorDetail: `ECONNRESET on attempt ${MODEL_STEP_ATTEMPTS}`,
    });
    expect(run.errorMessage).not.toContain('ECONNRESET');
  });

  it('fails with provider_unavailable, without calling a model, when the conversation’s provider is not configured', async () => {
    const { provider, turn, invoke } = await arrange({ script: [fakeReply({ text: 'unused' })], configured: false });

    await invoke().done;

    expect(provider.calls).toHaveLength(0);
    const { run, transcript } = await readTurn(turn);
    expect(run).toMatchObject({ status: 'failed', errorCode: 'provider_unavailable', model: null });
    expect(transcript).toEqual([]);
  });
});

describe('a paused response', () => {
  it('is resumed with another model request that sees what the model said so far', async () => {
    const { provider, turn, invoke } = await arrange({
      script: [fakeReply({ text: 'Searching the tools.', paused: true }), fakeReply({ text: 'Found it.' })],
    });

    await invoke().done;

    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1]?.transcript.at(-1)).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'Searching the tools.' }],
    });
    const { run, transcript } = await readTurn(turn);
    expect(run).toMatchObject({ status: 'completed', errorCode: null, modelRequestCount: 2 });
    expect(transcript.map((entry) => entry.entryKey)).toEqual([
      userTranscriptKey(turn.runId),
      modelTranscriptKey(turn.runId, 0),
      modelTranscriptKey(turn.runId, 1),
    ]);
  });
});

describe('the step limit', () => {
  it('ends a run whose model never stops calling tools with its own code', async () => {
    const { provider, turn, invoke } = await arrange({
      whenExhausted: (_input, call) =>
        fakeReply({ toolUses: [{ id: `tu_${call}`, name: listStudents.modelName, input: { page: call } }] }),
    });
    callToolMock.mockResolvedValue(toolSuccess('[]'));

    await invoke().done;

    expect(provider.calls).toHaveLength(MAX_MODEL_STEPS);
    expect(callToolMock).toHaveBeenCalledTimes(MAX_MODEL_STEPS);
    const { run, toolCalls, transcript } = await readTurn(turn);
    expect(run).toMatchObject({
      status: 'failed',
      errorCode: 'step_limit',
      modelRequestCount: MAX_MODEL_STEPS,
      inputTokens: MAX_MODEL_STEPS * FAKE_USAGE.inputTokens,
    });
    expect(run.errorMessage).toEqual(expect.stringMatching(/\S/));
    expect(run.completedAt).toBeInstanceOf(Date);
    expect(toolCalls.map((call) => call.status)).toEqual(Array.from({ length: MAX_MODEL_STEPS }, () => 'succeeded'));
    // Every call was answered, so the transcript can still be sent again.
    expect(transcript).toHaveLength(1 + 2 * MAX_MODEL_STEPS);
    expect(transcript.at(-1)).toMatchObject({
      role: 'user',
      entryKey: toolResultsTranscriptKey(turn.runId, MAX_MODEL_STEPS - 1),
    });
  });
});

describe('stopping', () => {
  it('cancels a run that was stopped before it began, without calling the model', async () => {
    const { provider, turn, invoke } = await arrange({ script: [fakeReply({ text: 'unused' })] });
    await requestStop(null, turn);

    await invoke().done;

    expect(provider.calls).toHaveLength(0);
    const { run, transcript } = await readTurn(turn);
    expect(run).toMatchObject({ status: 'cancelled', errorCode: null, modelRequestCount: 0 });
    expect(transcript).toEqual([]);
  });

  it('keeps the text streamed before a stop and ends the run cancelled', async () => {
    const { provider, turn, invoke } = await arrange({ script: [{ stopped: true, text: 'Partial ans', partialUsage: null, model: null }] });

    await invoke().done;

    expect(provider.calls).toHaveLength(1);
    const { run, items, transcript } = await readTurn(turn);
    // The stopped request is recorded, with no usage reported: zeros, marked incomplete.
    expect(run).toMatchObject({ status: 'cancelled', errorCode: null, modelRequestCount: 1, inputTokens: 0, costUsd: '0.00000000' });
    expect(await modelRequestsOf(turn.runId)).toMatchObject([
      { usageComplete: false, inputTokens: 0, outputTokens: 0, costUsd: '0.00000000', requestKey: modelTranscriptKey(turn.runId, 0) },
    ]);
    expect(items.map(({ kind, status, body }) => ({ kind, status, body }))).toEqual([
      { kind: 'user_message', status: 'complete', body: { text: QUESTION } },
      { kind: 'assistant_message', status: 'complete', body: { text: 'Partial ans' } },
    ]);
    expect(transcript.at(-1)).toEqual({
      role: 'assistant',
      entryKey: modelTranscriptKey(turn.runId, 0),
      content: [{ type: 'text', text: 'Partial ans' }],
    });
  });

  it('saves the usage a stopped request had reported, as incomplete, and charges it', async () => {
    const { turn, invoke } = await arrange({
      script: [{ stopped: true, text: '', partialUsage: FAKE_USAGE, model: 'answering-model' }],
    });

    await invoke().done;

    const { run } = await readTurn(turn);
    expect(run).toMatchObject({ status: 'cancelled', modelRequestCount: 1, inputTokens: FAKE_USAGE.inputTokens, costUsd: '0.00047313' });
    expect(await modelRequestsOf(turn.runId)).toMatchObject([
      { usageComplete: false, answeredModel: 'answering-model', ...FAKE_USAGE, costUsd: '0.00047313' },
    ]);
  });

  it('ends the run after a tool call that was running when the stop arrived, without asking the model again', async () => {
    const { provider, turn, invoke } = await arrange({
      script: [fakeReply({ toolUses: [readCall] }), fakeReply({ text: 'never requested' })],
    });
    const outcome = toolSuccess('[]');
    callToolMock.mockImplementationOnce(async () => {
      await requestStop(null, turn);
      return outcome;
    });

    await invoke().done;

    expect(provider.calls).toHaveLength(1);
    const { run, toolCalls, transcript } = await readTurn(turn);
    expect(run).toMatchObject({ status: 'cancelled', errorCode: null });
    expect(toolCalls.map((call) => call.status)).toEqual(['succeeded']);
    // The finished call's result is saved, so the transcript stays valid.
    expect(transcript.at(-1)).toMatchObject({
      entryKey: toolResultsTranscriptKey(turn.runId, 0),
      content: [{ toolUseId: readCall.id, content: outcome.modelContent, isError: false }],
    });
  });
});

describe('an expired delegated token', () => {
  it('fails the run with session_expired before the model is called', async () => {
    getRunTokenMock.mockResolvedValue(null);
    const { provider, turn, invoke } = await arrange({ script: [fakeReply({ text: 'unused' })] });

    const { ctx, done } = invoke();
    await done;

    expect(provider.calls).toHaveLength(0);
    // The handler ends the step itself; retrying cannot bring the token back.
    expect(ctx.attempts('model-0')).toBe(1);
    expect(loadToolCatalogMock).not.toHaveBeenCalled();
    const { run } = await readTurn(turn);
    expect(run).toMatchObject({ status: 'failed', errorCode: 'session_expired', modelRequestCount: 0 });
  });

  /**
   * The run fails, the open call is answered in the transcript so the
   * conversation can go on, and the call itself gets a final status
   * (`settleOpenToolCalls`) instead of a spinner on a turn that is over.
   */
  it('fails the run, answers the open tool call and settles it when the token expired while the user decided', async () => {
    const { provider, turn, invoke } = await arrange({
      script: [fakeReply({ toolUses: [writeCall] }), fakeReply({ text: 'never requested' })],
    });
    const { ctx, done } = invoke();

    const approval = await waitForPendingApproval(turn, done);
    getRunTokenMock.mockResolvedValue(null);
    await respondToApproval(ctx, approval, 'approve');
    await done;

    expect(callToolMock).not.toHaveBeenCalled();
    expect(provider.calls).toHaveLength(1);
    const { run, transcript, toolCalls } = await readTurn(turn);
    expect(run).toMatchObject({ status: 'failed', errorCode: 'session_expired' });
    expect(transcript.at(-1)).toEqual({
      role: 'user',
      entryKey: interruptedTranscriptKey(turn.runId),
      content: [
        { type: 'tool_result', toolUseId: writeCall.id, toolName: writeCall.name, content: expect.any(String), isError: true },
      ],
    });
    expect(toolCalls.map((call) => call.status)).toEqual(['failed']);
  });
});

describe('the access check before each model request', () => {
  it('stops a tool loop at the school’s limit with its own code, keeping what already ran', async () => {
    let checks = 0;
    const checkAccess: RunAccessCheck = async () => {
      checks += 1;
      // Allowed for the first model request and the read it asks for.
      return checks <= 2
        ? { allowed: true }
        : { allowed: false, code: 'limit_reached', message: 'This school has reached its AI assistant limit for this month.' };
    };
    const { provider, turn, invoke } = await arrange({
      script: [fakeReply({ toolUses: [readCall] })],
      checkAccess,
    });
    callToolMock.mockResolvedValue(toolSuccess('[{"id":"stu_1"}]'));

    await invoke().done;

    // Only the first request was made; the read it asked for ran.
    expect(provider.calls).toHaveLength(1);
    expect(callToolMock).toHaveBeenCalledTimes(1);
    const { run, toolCalls } = await readTurn(turn);
    expect(run).toMatchObject({
      status: 'failed',
      errorCode: 'limit_reached',
      errorMessage: 'This school has reached its AI assistant limit for this month.',
      modelRequestCount: 1,
    });
    expect(toolCalls.map((call) => call.status)).toEqual(['succeeded']);
  });

  it('fails the run before any model request when the user may no longer use the assistant', async () => {
    const { provider, turn, invoke } = await arrange({
      script: [fakeReply({ text: 'never sent' })],
      checkAccess: async () => ({ allowed: false, code: 'feature_disabled', message: 'The AI assistant is not enabled for this school.' }),
    });

    await invoke().done;

    expect(provider.calls).toHaveLength(0);
    const { run } = await readTurn(turn);
    expect(run).toMatchObject({ status: 'failed', errorCode: 'feature_disabled', modelRequestCount: 0 });
  });
});

describe('the cost of each model request', () => {
  it('is saved once per request with the prices it was made at, and the run holds their exact sum', async () => {
    const { provider, turn, invoke } = await arrange({
      script: [fakeReply({ toolUses: [readCall], model: 'answered-model-1' }), fakeReply({ text: 'Done.', model: 'answered-model-2' })],
      providerModel: 'configured-model',
    });
    callToolMock.mockResolvedValue(toolSuccess('[]'));

    await invoke().done;

    expect(provider.calls).toHaveLength(2);
    const requests = await modelRequestsOf(turn.runId);
    // (100 × 2.5 + 20 × 10 + 30 × 0.25 + 5 × 3.125) ÷ 10⁶ = 0.000473125, stored at 8 decimals.
    const expected = {
      runId: turn.runId,
      schoolId: turn.schoolId,
      userId: turn.userId,
      provider: 'anthropic',
      requestedModel: 'configured-model',
      ...FAKE_USAGE,
      inputUsdPerMtok: '2.500000',
      outputUsdPerMtok: '10.000000',
      cacheReadUsdPerMtok: '0.250000',
      cacheWriteUsdPerMtok: '3.125000',
      costUsd: '0.00047313',
    };
    expect(FAKE_PRICES).toEqual({ inputUsdPerMtok: '2.5', outputUsdPerMtok: '10', cacheReadUsdPerMtok: '0.25', cacheWriteUsdPerMtok: '3.125' });
    expect(requests.map((request) => request.usageComplete)).toEqual([true, true]);
    expect(requests).toMatchObject([
      { ...expected, answeredModel: 'answered-model-1', requestKey: modelTranscriptKey(turn.runId, 0) },
      { ...expected, answeredModel: 'answered-model-2', requestKey: modelTranscriptKey(turn.runId, 1) },
    ]);
    const { run } = await readTurn(turn);
    expect(run).toMatchObject({ status: 'completed', modelRequestCount: 2, costUsd: '0.00094626' });
  });

  it('is never incurred when the provider has no prices: the run fails before the model is called', async () => {
    const provider = createFakeProvider({ script: [fakeReply({ text: 'never sent' })] });
    const turn = await seedTurn({ provider: provider.id });
    const processRun = createRunProcessor({
      providers: { ...fakeProviderRegistry(provider), prices: () => null },
      log,
      checkAccess: async () => ({ allowed: true }),
    });

    await processRun(createFakeRunContext(), turn.input);

    expect(provider.calls).toHaveLength(0);
    const { run } = await readTurn(turn);
    expect(run).toMatchObject({ status: 'failed', errorCode: 'provider_unavailable', costUsd: '0.00000000' });
    expect(await modelRequestsOf(turn.runId)).toEqual([]);
  });
});

describe('the access check before each tool call', () => {
  it('fails the run with the refusal’s code and runs no tool once access is revoked', async () => {
    let checks = 0;
    const checkAccess: RunAccessCheck = async () => {
      checks += 1;
      return checks === 1
        ? { allowed: true }
        : { allowed: false, code: 'role_not_enabled', message: 'Your role cannot use the AI assistant in this school.' };
    };
    const { turn, invoke } = await arrange({ script: [fakeReply({ toolUses: [readCall] })], checkAccess });

    await invoke().done;

    expect(callToolMock).not.toHaveBeenCalled();
    const { run, toolCalls } = await readTurn(turn);
    expect(run).toMatchObject({ status: 'failed', errorCode: 'role_not_enabled' });
    expect(toolCalls.map((call) => call.status)).toEqual(['failed']);
  });
});

describe('a billed request that failed', () => {
  it('is saved per attempt before the step is retried, with its usage marked complete or not', async () => {
    const { provider, turn, invoke } = await arrange({
      script: [
        withBilledUsage(new FakeModelError('busy', 'stream broke'), { usage: FAKE_USAGE, complete: false, model: 'partial-model' }),
        withBilledUsage(new Error('malformed function call'), { usage: FAKE_USAGE, complete: true, model: 'final-model' }),
        fakeReply({ text: 'Done.' }),
      ],
    });

    await invoke().done;

    expect(provider.calls).toHaveLength(3);
    const requests = await modelRequestsOf(turn.runId);
    const stepKey = modelTranscriptKey(turn.runId, 0);
    expect(requests.map((request) => [request.requestKey, request.usageComplete, request.answeredModel, request.costUsd])).toEqual([
      [stepKey, true, FAKE_REPORTED_MODEL, '0.00047313'],
      [`${stepKey}:attempt:1`, false, 'partial-model', '0.00047313'],
      [`${stepKey}:attempt:2`, true, 'final-model', '0.00047313'],
    ]);
    const { run } = await readTurn(turn);
    expect(run).toMatchObject({ status: 'completed', modelRequestCount: 3, costUsd: '0.00141939' });
  });

  it('saves nothing for a failure the provider reported no usage for', async () => {
    const { turn, invoke } = await arrange({ script: [new FakeModelError('busy', '429'), fakeReply({ text: 'Done.' })] });
    await invoke().done;
    expect((await modelRequestsOf(turn.runId)).map((request) => request.requestKey)).toEqual([modelTranscriptKey(turn.runId, 0)]);
  });
});
