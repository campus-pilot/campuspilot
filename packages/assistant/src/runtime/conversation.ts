import { ASSISTANT_TERMINAL_RUN_STATUSES } from '@campuspilot/assistant-contract/dto';
import type { Logger } from '@campuspilot/logger';
import * as restate from '@restatedev/restate-sdk';

import { db } from '../db';
import type { AssistantToolCallBody, AssistantUserMessageBody } from '@campuspilot/db/schema/assistant';
import { isAssistantRunStopSignalled, publishAssistantEvent, rememberStreamingText } from '../events';
import { createTextRelease } from './text-release';
import { getRunToken } from '../run-token';
import * as store from '../store';
import {
  assistantMessageItemKey,
  interruptedTranscriptKey,
  modelTranscriptKey,
  toolCallItemKey,
  toolResultsTranscriptKey,
  userMessageItemKey,
  userTranscriptKey,
} from '../transcript';
import {
  ASSISTANT_CONVERSATION_OBJECT,
  type ApprovalResolution,
  type AssistantConversationHandlers,
  type ProcessRunInput,
} from './contract';
import { buildAssistantPrompt, type AssistantConversationFacts } from './prompt';
import type { ProviderRegistry } from './providers/registry';
import type { ModelProvider, ModelToolResult, TranscriptEntry } from './providers/types';
import { showViewInputSchema } from '@campuspilot/assistant-contract/views';

import {
  callTool,
  loadToolCatalog,
  requiresApproval,
  toModelToolName,
  type AssistantTool,
  type ToolOutcome,
} from './tools';

/**
 * Today's calendar date in India (Asia/Kolkata, `YYYY-MM-DD`), the schools'
 * time zone, for the prompt: a UTC date is yesterday's until 05:30 IST.
 * Read inside the run's first durable step, so a replay keeps it.
 */
const istToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

/** The usage saved for a stopped request that reported none. */
const NO_USAGE = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };

/** Model requests one run may make before it stops to protect against loops. */
export const MAX_MODEL_STEPS = 20;

/**
 * Attempts of one model request. Restate's `maxRetryAttempts` counts the
 * first attempt too, so this is the first request and 2 retries. A request
 * that failed is paid for at most once more per retry, so this stays small.
 * Failures the provider says cannot be fixed by retrying never get here
 * (see `modelStep`).
 */
export const MODEL_STEP_RETRY = { maxRetryAttempts: 3, initialRetryInterval: 2_000 };
/**
 * Attempts (the first included) of steps that only touch the assistant's
 * own database, and of tool steps. Every such step is safe to repeat: inserts are keyed (see
 * transcript.ts), reads are harmless, and a write is sent to the API at
 * most once however often its step runs (see `executeToolCall`).
 */
const DB_STEP_RETRY = { maxRetryAttempts: 5, initialRetryInterval: 500 };

export const DECLINED_RESULT = 'The user declined this action. Do not retry it; ask what they would like instead.';
export const CANCELLED_RESULT = 'The user stopped the assistant before this action ran.';
const REFUSAL_TEXT = 'I can’t help with that request.';

/**
 * Added to a write's result when it is reported from the item after a
 * replay and the item kept only the start of it (the model's own copy is
 * longer and was lost with the crash).
 */
export const RECOVERED_OUTPUT_CUT_NOTE =
  '[Only the start of this result was kept. Read the data again if you need the rest.]';

/**
 * Reported when a write was handed to the API but its outcome never came
 * back (the connection dropped, or the service restarted mid-call). The
 * write is not sent again: it may already have been applied.
 */
export const OUTCOME_UNKNOWN_ERROR = {
  code: 'OUTCOME_UNKNOWN',
  message:
    'The connection was lost while this change was being made, so it may or may not have been applied. Check the current data before trying it again.',
};

/**
 * Whether the run's user may still use the assistant in its school, asked
 * before every model request: the API's `resolveAssistantAccess` (feature,
 * role, the school's monthly limit), injected by `apps/worker` so the turn
 * loop itself imports no API code. A refusal ends the run with its code and
 * message; writes that were already approved and made stay made.
 */
export type RunAccessCheck = (input: {
  schoolId: string;
  userId: string;
}) => Promise<{ allowed: true } | { allowed: false; code: string; message: string }>;

export type AssistantConversationDeps = {
  providers: ProviderRegistry;
  log: Logger;
  checkAccess: RunAccessCheck;
};

type RunFailure = { code: string; message: string; detail?: string };

const failureJson = (failure: RunFailure) => JSON.stringify(failure);

/**
 * A run failure with an explicit code. Restate replays errors with their
 * message only, so the code, the user's message and the raw detail for
 * developers travel inside it as JSON. By default it ends the run at once
 * (a terminal error). A `retryable` one is a plain error, so the step's
 * retry policy applies; if every attempt fails, Restate ends the step with
 * this message and the run reports this code instead of a generic one.
 */
function runFailure(code: string, message: string, { detail, retryable = false }: { detail?: string; retryable?: boolean } = {}) {
  const json = failureJson({ code, message, ...(detail ? { detail } : {}) });
  return retryable ? new Error(json) : new restate.TerminalError(json);
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Our own failures carry their code and message. Anything else (for example
 * ctx.run giving up after its retries on an unclassified error) gets the
 * generic message, and its raw text is kept as `detail` for developers.
 */
function readRunFailure(error: restate.TerminalError): RunFailure {
  try {
    const parsed = JSON.parse(error.message) as { code?: unknown; message?: unknown; detail?: unknown };
    if (typeof parsed.code === 'string' && typeof parsed.message === 'string') {
      return {
        code: parsed.code,
        message: parsed.message,
        ...(typeof parsed.detail === 'string' ? { detail: parsed.detail } : {}),
      };
    }
  } catch {
    // Not one of ours.
  }
  return {
    code: 'model_error',
    message: 'The assistant could not finish this request. Please try again.',
    detail: error.message,
  };
}

/** The run's delegated token; without one the run cannot act as the user. */
async function requireToken(runId: string): Promise<string> {
  const token = await getRunToken(runId);
  if (!token) {
    throw runFailure(
      'session_expired',
      'This request waited too long and its access expired. Send your message again.',
    );
  }
  return token;
}

type RunFacts = {
  runId: string;
  conversationId: string;
  schoolId: string;
  userId: string;
  /** The provider the conversation runs on. */
  providerId: ModelProvider['id'];
  facts: AssistantConversationFacts;
};

type ToolUse = { id: string; name: string; input: unknown };

type ModelStepOutcome =
  | { kind: 'stopped' }
  | { kind: 'response'; toolUses: ToolUse[]; paused: boolean };

type PreparedToolCall =
  | { action: 'result'; result: ModelToolResult }
  | { action: 'execute'; itemId: string }
  | { action: 'approve'; itemId: string };

/** Runs one database step inside its own transaction and publishes after commit. */
const tx = <T>(work: Parameters<typeof store.assistantTransaction<T>>[1]) =>
  store.assistantTransaction(db, work);

const NOT_RUN_ERROR = {
  code: 'NOT_RUN',
  message: 'This action did not run because the assistant stopped first.',
};

/**
 * Gives every tool call of an ending run a final status, so the chat never
 * shows a spinner or an approval request on a turn that is over. A call
 * waiting for approval never ran. A running write that was already handed
 * to the API (`executionStartedAt`) may have been applied, so it is reported
 * as unknown rather than as not run.
 */
async function settleOpenToolCalls(
  t: Parameters<Parameters<typeof tx>[0]>[0],
  emit: Parameters<Parameters<typeof tx>[0]>[1],
  run: { id: string; conversationId: string },
  runStatus: 'completed' | 'failed' | 'cancelled',
) {
  for (const item of await store.findOpenToolCalls(t, run)) {
    const body = item.body as AssistantToolCallBody;
    if (item.status === 'awaiting_approval') {
      await store.updateItem(t, emit, item, { status: 'cancelled' });
    } else if (body.executionStartedAt) {
      await store.updateItem(t, emit, item, { status: 'failed', body: { ...body, error: OUTCOME_UNKNOWN_ERROR } });
    } else if (runStatus === 'cancelled') {
      await store.updateItem(t, emit, item, { status: 'cancelled' });
    } else {
      await store.updateItem(t, emit, item, { status: 'failed', body: { ...body, error: NOT_RUN_ERROR } });
    }
  }
}

async function finishRun(
  run: { id: string; conversationId: string },
  status: 'completed' | 'failed' | 'cancelled',
  error?: RunFailure,
) {
  await tx(async (t, emit) => {
    await store.completeStreamingItems(t, emit, run);
    await settleOpenToolCalls(t, emit, run, status);
    await store.updateRun(t, emit, run, {
      status,
      completedAt: new Date(),
      ...(error ? { errorCode: error.code, errorMessage: error.message, errorDetail: error.detail ?? null } : {}),
    });
  });
}

/**
 * Every assistant message that ends in tool calls must be answered by
 * results for all of them, or the transcript cannot be sent again. When a run
 * ends mid-loop (stop or failure), the unanswered calls get error results.
 */
async function closeToolLoop(
  provider: ModelProvider,
  run: RunFacts,
  toolUses: ToolUse[],
  answered: ModelToolResult[],
  entryKey: string,
  reason: string,
) {
  const answeredIds = new Set(answered.map((result) => result.toolUseId));
  const results: ModelToolResult[] = [
    ...answered,
    ...toolUses
      .filter((toolUse) => !answeredIds.has(toolUse.id))
      .map((toolUse) => ({ toolUseId: toolUse.id, toolName: toolUse.name, content: reason, isError: true })),
  ];
  await tx((t) =>
    store.appendTranscriptEntry(t, {
      conversationId: run.conversationId,
      runId: run.runId,
      role: 'user',
      content: provider.toolResultsContent(results),
      entryKey,
    }),
  );
}

function runRef(run: RunFacts) {
  return { id: run.runId, conversationId: run.conversationId };
}

/**
 * What a turn needs from Restate: durable steps and awakeables. Narrowed
 * from the object context so tests can drive a turn without a Restate server.
 */
export type RunContext = Pick<restate.ObjectContext, 'run' | 'awakeable'>;

/** Builds the handler that processes one turn (see `processRun` inside). */
export function createRunProcessor(deps: AssistantConversationDeps) {
  /** The provider a run uses; it was checked when the run began. */
  const providerFor = (run: RunFacts): ModelProvider => {
    const provider = deps.providers.get(run.providerId);
    if (!provider) {
      throw runFailure('provider_unavailable', `The ${run.providerId} model provider is no longer configured.`);
    }
    return provider;
  };

  /** Loads the run and marks it running, or ends it when it must not run. */
  async function beginRun({ runId, user }: ProcessRunInput): Promise<RunFacts | null> {
    const run = await store.findRun(db, runId);
    if (!run || ASSISTANT_TERMINAL_RUN_STATUSES.has(run.status)) return null;
    if (run.stopRequestedAt) {
      await finishRun(run, 'cancelled');
      return null;
    }
    const [item, conversation] = await Promise.all([
      store.findItemByKey(db, run.conversationId, userMessageItemKey(run.id)),
      store.findConversation(db, run.conversationId),
    ]);
    if (!item || !conversation) {
      await finishRun(run, 'failed', {
        code: 'missing_context',
        message: 'This conversation no longer exists.',
      });
      return null;
    }
    const provider = deps.providers.get(conversation.provider);
    if (!provider) {
      await finishRun(run, 'failed', {
        code: 'provider_unavailable',
        message: `This conversation runs on ${conversation.provider}, which is not configured now. Start a new conversation.`,
      });
      return null;
    }

    await tx(async (t, emit) => {
      await store.appendTranscriptEntry(t, {
        conversationId: run.conversationId,
        runId: run.id,
        role: 'user',
        content: provider.userContent(item.body as AssistantUserMessageBody),
        entryKey: userTranscriptKey(run.id),
      });
      // The model the provider is configured to call now, which is what this
      // run will request. Not `conversation.model`: that is only the model
      // the conversation started on. Each model step then replaces it with
      // the model that actually answered.
      await store.updateRun(t, emit, run, {
        status: 'running',
        startedAt: run.startedAt ?? new Date(),
        provider: provider.id,
        model: provider.model,
      });
    });

    return {
      runId: run.id,
      conversationId: run.conversationId,
      schoolId: run.schoolId,
      userId: run.userId,
      providerId: provider.id,
      facts: {
        schoolId: run.schoolId,
        schoolName: await lookUpSchoolName(run.id, run.schoolId),
        userName: user.name,
        userEmail: user.email,
        today: istToday(),
      },
    };
  }

  /** The school's display name, through the same MCP tools as everything else. */
  async function lookUpSchoolName(runId: string, schoolId: string): Promise<string | null> {
    const token = await getRunToken(runId);
    if (!token) return null;
    try {
      const catalog = await loadToolCatalog(token);
      const tool = catalog.tools.get(toModelToolName('school.listMySchools'));
      if (!tool) return null;
      const outcome = await callTool(token, tool, {});
      if (!outcome.ok) return null;
      // The whole result: the stored and model copies are cut to a length
      // and would not parse for a user with many schools.
      const schools = JSON.parse(outcome.text) as Array<{ id: string; name: string }>;
      return schools.find((school) => school.id === schoolId)?.name ?? null;
    } catch (err) {
      deps.log.warn({ err, runId }, 'assistant.school-name.failed');
      return null;
    }
  }

  /**
   * One model request. Its text streams to subscribers as it arrives; the
   * finished response, visible message and token usage are saved together.
   * A retry after the response was saved reuses it instead of paying for,
   * and showing, a second answer.
   */
  async function modelStep(run: RunFacts, step: number): Promise<ModelStepOutcome> {
    const entryKey = modelTranscriptKey(run.runId, step);
    const saved = await store.findTranscriptEntry(db, run.conversationId, entryKey);
    const provider = providerFor(run);
    if (saved) {
      return { kind: 'response', toolUses: provider.toolUsesOf(saved.content), paused: false };
    }

    // Every request is paid: the feature, the user's role and the school's
    // limit are checked again before each one, so a long tool loop stops
    // once the school reaches its limit (within the spend cache's age).
    const access = await deps.checkAccess({ schoolId: run.schoolId, userId: run.userId });
    if (!access.allowed) throw runFailure(access.code, access.message);

    // Every request is saved with the prices it was made at, so a provider
    // without prices is never called.
    const prices = deps.providers.prices(provider.id);
    if (!prices) {
      throw runFailure('provider_unavailable', 'The assistant is not available right now. Please try again later.', {
        detail: `No prices are configured for ${provider.id}.`,
      });
    }

    const catalog = await loadToolCatalog(await requireToken(run.runId));
    const transcript = await store.loadTranscript(db, run.conversationId);
    const itemKey = assistantMessageItemKey(run.runId, step);

    let itemPromise: ReturnType<typeof store.insertItem> | null = null;
    const ensureItem = () =>
      (itemPromise ??= tx((t, emit) =>
        store.insertItem(t, emit, {
          conversationId: run.conversationId,
          runId: run.runId,
          kind: 'assistant_message',
          status: 'streaming',
          body: { text: '' },
          itemKey,
        }),
      ));

    // One chain keeps deltas in order; a failed publish never blocks the rest.
    let publishing: Promise<unknown> = Promise.resolve();
    const onText = createTextRelease({
      publish: ({ offset, delta, text }) => {
        publishing = publishing
          .then(() => ensureItem())
          .then(async (item) => {
            await rememberStreamingText(item.id, text);
            await publishAssistantEvent(run.conversationId, { type: 'text', itemId: item.id, offset, delta });
          })
          .catch((err) => deps.log.warn({ err, runId: run.runId }, 'assistant.text.publish.failed'));
      },
    });

    let result: Awaited<ReturnType<ModelProvider['step']>>;
    try {
      result = await provider.step({
        prompt: buildAssistantPrompt(run.facts),
        tools: catalog.ordered,
        transcript: transcript as TranscriptEntry[],
        onText,
        isStopRequested: () => isAssistantRunStopSignalled(run.runId),
      });
    } catch (error) {
      const kind = provider.failureKind(error);
      deps.log.error(
        {
          err: error,
          runId: run.runId,
          conversationId: run.conversationId,
          schoolId: run.schoolId,
          step,
          provider: provider.id,
          model: provider.model,
          kind,
        },
        'assistant.model.error',
      );
      const detail = errorText(error);
      if (kind === 'rejected') {
        throw runFailure(
          'model_rejected',
          'The assistant could not process this request. Please try rephrasing it.',
          { detail },
        );
      }
      if (kind === 'unavailable') {
        // A wrong key or model id: retrying, or rephrasing, cannot help.
        throw runFailure(
          'provider_unavailable',
          'The assistant is not available right now. Please try again later.',
          { detail },
        );
      }
      if (kind === 'busy') {
        throw runFailure(
          'model_busy',
          'The assistant is busy right now. Please try again in a few minutes.',
          { detail, retryable: true },
        );
      }
      throw error;
    }

    if (result.stopped) {
      const text = result.text;
      const item = text ? await ensureItem() : null;
      await tx(async (t, emit) => {
        // A stopped request is paid for too. Its usage is what the provider
        // had reported before the abort (zeros when nothing arrived), saved as
        // incomplete so the gap shows on the billing page.
        await store.recordModelRequest(t, {
          runId: run.runId,
          schoolId: run.schoolId,
          userId: run.userId,
          requestKey: entryKey,
          provider: provider.id,
          requestedModel: provider.model,
          answeredModel: result.model ?? provider.model,
          usage: result.partialUsage ?? NO_USAGE,
          usageComplete: false,
          prices,
        });
        if (item) {
          await store.updateItem(t, emit, item, { status: 'complete', body: { text } });
          await store.appendTranscriptEntry(t, {
            conversationId: run.conversationId,
            runId: run.runId,
            role: 'assistant',
            content: provider.assistantTextContent(text),
            entryKey,
          });
        }
        await store.updateRun(t, emit, runRef(run), {});
      });
      return { kind: 'stopped' };
    }

    const text = result.text || (result.refusal ? REFUSAL_TEXT : '');
    // A refused turn's tool calls must not run, whatever the provider sent.
    // Only its visible text is saved: calls left in the transcript without
    // results would make every later request in this conversation invalid,
    // and a step replayed from the saved entry must find no calls either.
    const toolUses = result.refusal ? [] : result.toolUses;
    const content = result.refusal ? provider.assistantTextContent(text) : result.content;
    const item = text ? await ensureItem() : itemPromise ? await itemPromise : null;
    await tx(async (t, emit) => {
      // First, so the run's row is locked before the conversation's (see
      // `recordModelRequest`). Keyed like the transcript entry: a step
      // replayed after this commit returns early above and adds nothing.
      await store.recordModelRequest(t, {
        runId: run.runId,
        schoolId: run.schoolId,
        userId: run.userId,
        requestKey: entryKey,
        provider: provider.id,
        requestedModel: provider.model,
        answeredModel: result.model,
        usage: result.usage,
        usageComplete: true,
        prices,
      });
      if (item) {
        await store.updateItem(t, emit, item, { status: 'complete', body: { text } });
      }
      await store.appendTranscriptEntry(t, {
        conversationId: run.conversationId,
        runId: run.runId,
        role: 'assistant',
        content,
        entryKey,
      });
      // The model that answered: a provider may serve a request with a
      // different model than the one asked for (a fallback, a dated version).
      await store.updateRun(t, emit, runRef(run), { model: result.model });
    });

    return { kind: 'response', toolUses, paused: result.refusal ? false : result.paused };
  }

  /** Records the tool call and decides whether it runs or waits for approval. */
  async function prepareToolCall(run: RunFacts, toolUse: ToolUse): Promise<PreparedToolCall> {
    const catalog = await loadToolCatalog(await requireToken(run.runId));
    const tool = catalog.tools.get(toolUse.name);
    if (!tool) {
      return {
        action: 'result',
        result: {
          toolUseId: toolUse.id,
          toolName: toolUse.name,
          content: JSON.stringify({ code: 'NOT_FOUND', message: `Unknown tool ${toolUse.name}.` }),
          isError: true,
        },
      };
    }

    if (tool.source === 'local') return showView(run, toolUse);

    const needsApproval = requiresApproval(tool);
    const body: AssistantToolCallBody = {
      toolUseId: toolUse.id,
      toolName: tool.mcpName,
      title: tool.title,
      access: tool.readOnly ? 'read' : 'write',
      destructive: tool.destructive,
      module: tool.module,
      input: toolUse.input ?? {},
    };
    const item = await tx((t, emit) =>
      store.insertItem(t, emit, {
        conversationId: run.conversationId,
        runId: run.runId,
        kind: 'tool_call',
        status: needsApproval ? 'awaiting_approval' : 'running',
        body,
        itemKey: toolCallItemKey(run.runId, toolUse.id),
      }),
    );
    return needsApproval
      ? { action: 'approve', itemId: item.id }
      : { action: 'execute', itemId: item.id };
  }

  /**
   * Shows a view: validated against the contract, saved as a timeline item,
   * acknowledged to the model. A view that does not validate goes back to the
   * model with the problems, so it can correct and call again.
   */
  async function showView(run: RunFacts, toolUse: ToolUse): Promise<PreparedToolCall> {
    const result = (content: string, isError: boolean): PreparedToolCall => ({
      action: 'result',
      result: { toolUseId: toolUse.id, toolName: toolUse.name, content, isError },
    });
    const parsed = showViewInputSchema.safeParse(toolUse.input ?? {});
    if (!parsed.success) {
      return result(
        JSON.stringify({
          code: 'BAD_REQUEST',
          message: 'The view does not match the schema.',
          issues: parsed.error.issues.slice(0, 8).map((issue) => ({
            path: issue.path.map(String).join('.'),
            message: issue.message,
          })),
        }),
        true,
      );
    }
    await tx((t, emit) =>
      store.insertItem(t, emit, {
        conversationId: run.conversationId,
        runId: run.runId,
        kind: 'view',
        status: 'complete',
        body: { view: parsed.data.view },
        itemKey: toolCallItemKey(run.runId, toolUse.id),
      }),
    );
    return result('Shown to the user. Do not repeat its contents in text.', false);
  }

  /**
   * Creates the approval the user decides on. Returns false when the run was
   * stopped first, in which case nothing waits. The stop check and the
   * approval are one transaction holding the run's row lock: a Stop either
   * commits before it (and the approval is refused here) or after it (and
   * then finds the approval and cancels it). Checked outside the lock, a
   * Stop landing in between would find no approval, and the run would wait
   * on one nobody can answer.
   */
  async function requestApproval(
    run: RunFacts,
    itemId: string,
    toolName: string,
    awakeableId: string,
  ): Promise<boolean> {
    return tx(async (t, emit) => {
      const current = await store.lockRun(t, run.runId);
      if (!current || current.stopRequestedAt) return false;
      const approval = await store.insertApproval(t, {
        conversationId: run.conversationId,
        runId: run.runId,
        itemId,
        schoolId: run.schoolId,
        userId: run.userId,
        toolName,
        awakeableId,
      });
      const item = await store.findItem(t, itemId);
      if (item) {
        await store.updateItem(t, emit, item, {
          body: { ...(item.body as AssistantToolCallBody), approvalId: approval.id },
        });
      }
      await store.updateRun(t, emit, runRef(run), { status: 'awaiting_approval' });
      return true;
    });
  }

  async function applyResolution(
    run: RunFacts,
    itemId: string,
    decision: ApprovalResolution['decision'],
  ) {
    await tx(async (t, emit) => {
      const item = await store.findItem(t, itemId);
      if (item) {
        await store.updateItem(t, emit, item, {
          status: decision === 'approve' ? 'running' : decision === 'decline' ? 'declined' : 'cancelled',
        });
      }
      if (decision !== 'cancel') {
        await store.updateRun(t, emit, runRef(run), { status: 'running' });
      }
    });
  }

  /**
   * Hands a write to the API at most once, however often this step runs.
   * The intent is saved on the item first (`executionStartedAt`); a step
   * repeated after a crash or a failed save finds it and never sends the
   * write again. It then reports what the item already recorded, or, when
   * nothing was recorded, that the outcome is unknown. A dropped connection
   * is an unknown outcome too: the API may have applied the change.
   */
  async function callWriteOnce(
    run: RunFacts,
    token: string,
    tool: AssistantTool,
    toolUse: ToolUse,
    itemId: string,
  ): Promise<ToolOutcome | { recorded: ModelToolResult }> {
    const earlier = await tx(async (t, emit) => {
      const item = await store.findItem(t, itemId);
      if (!item) return null;
      const body = item.body as AssistantToolCallBody;
      if (body.executionStartedAt) return { status: item.status, body };
      await store.updateItem(t, emit, item, {
        body: { ...body, executionStartedAt: new Date().toISOString() },
      });
      return null;
    });
    if (earlier) {
      deps.log.warn(
        { runId: run.runId, conversationId: run.conversationId, tool: tool.mcpName, status: earlier.status },
        'assistant.tool.write-not-repeated',
      );
      if (earlier.status === 'succeeded' && earlier.body.output !== undefined) {
        return {
          recorded: {
            toolUseId: toolUse.id,
            toolName: toolUse.name,
            content: earlier.body.outputTruncated ? `${earlier.body.output}\n${RECOVERED_OUTPUT_CUT_NOTE}` : earlier.body.output,
            isError: false,
          },
        };
      }
      return { ok: false, error: earlier.body.error ?? OUTCOME_UNKNOWN_ERROR };
    }
    try {
      return await callTool(token, tool, toolUse.input ?? {});
    } catch (err) {
      deps.log.error(
        { err, runId: run.runId, conversationId: run.conversationId, tool: tool.mcpName },
        'assistant.tool.write-outcome-unknown',
      );
      return { ok: false, error: OUTCOME_UNKNOWN_ERROR };
    }
  }

  /**
   * Runs one tool call and records its result on the item. Reads may run
   * more than once when the step is retried; writes never do.
   */
  async function executeToolCall(
    run: RunFacts,
    toolUse: ToolUse,
    itemId: string,
  ): Promise<ModelToolResult> {
    const token = await requireToken(run.runId);
    const catalog = await loadToolCatalog(token);
    const tool = catalog.tools.get(toolUse.name);
    // The API can stop offering a tool while a call waits for approval.
    const outcome: ToolOutcome | { recorded: ModelToolResult } = !tool
      ? { ok: false, error: { code: 'NOT_FOUND', message: `The tool ${toolUse.name} is no longer available.` } }
      : tool.readOnly
        ? await callTool(token, tool, toolUse.input ?? {})
        : await callWriteOnce(run, token, tool, toolUse, itemId);
    if ('recorded' in outcome) return outcome.recorded;

    if (!outcome.ok) {
      deps.log.info(
        { runId: run.runId, conversationId: run.conversationId, tool: tool?.mcpName ?? toolUse.name, code: outcome.error.code },
        'assistant.tool.failed',
      );
    }
    await tx(async (t, emit) => {
      const item = await store.findItem(t, itemId);
      if (!item) return;
      const body = item.body as AssistantToolCallBody;
      await store.updateItem(t, emit, item, outcome.ok
        ? {
            status: 'succeeded',
            body: { ...body, output: outcome.storedOutput, outputTruncated: outcome.outputTruncated },
          }
        : { status: 'failed', body: { ...body, error: outcome.error } });
    });
    return outcome.ok
      ? { toolUseId: toolUse.id, toolName: toolUse.name, content: outcome.modelContent, isError: false }
      : { toolUseId: toolUse.id, toolName: toolUse.name, content: JSON.stringify(outcome.error), isError: true };
  }

  /**
   * One turn, as a durable Restate handler. Restate records the result of
   * every `ctx.run` and, after a crash, replays the handler: finished steps
   * return their recorded result without running again, and only the step
   * that was interrupted runs a second time. That is why:
   * - every step's name is fixed by its place in the turn (`model-<step>`,
   *   `tool-<toolUseId>`), so a replay lines up with the record. Renaming or
   *   reordering steps breaks turns that are waiting for approval during a
   *   deploy;
   * - every step is safe to run twice (keyed inserts, at-most-once writes);
   * - nothing outside a step may read the clock, the database or Redis.
   * The three `cancelled` steps share a name on purpose: a turn reaches at
   * most one of them.
   */
  async function processRun(ctx: RunContext, input: ProcessRunInput) {
    const run = await ctx.run('begin', () => beginRun(input), DB_STEP_RETRY);
    if (!run) return;

    /** Tool calls of the latest model response still waiting for results. */
    let open: { toolUses: ToolUse[]; answered: ModelToolResult[] } | null = null;

    try {
      for (let step = 0; step < MAX_MODEL_STEPS; step++) {
        const outcome = await ctx.run(`model-${step}`, () => modelStep(run, step), MODEL_STEP_RETRY);
        if (outcome.kind === 'stopped') {
          await ctx.run('cancelled', () => finishRun(runRef(run), 'cancelled'), DB_STEP_RETRY);
          return;
        }
        if (outcome.toolUses.length === 0) {
          if (outcome.paused) continue;
          await ctx.run('completed', () => finishRun(runRef(run), 'completed'), DB_STEP_RETRY);
          return;
        }

        open = { toolUses: outcome.toolUses, answered: [] };
        let cancelled = false;
        for (const toolUse of outcome.toolUses) {
          const prepared = await ctx.run(
            `tool-prepare-${toolUse.id}`,
            () => prepareToolCall(run, toolUse),
            DB_STEP_RETRY,
          );
          if (prepared.action === 'result') {
            open.answered.push(prepared.result);
            continue;
          }

          if (prepared.action === 'approve') {
            const approval = ctx.awakeable<ApprovalResolution>();
            const waiting = await ctx.run(
              `approval-request-${toolUse.id}`,
              () => requestApproval(run, prepared.itemId, toolUse.name, approval.id),
              DB_STEP_RETRY,
            );
            const decision = waiting ? (await approval.promise).decision : 'cancel';
            await ctx.run(
              `approval-result-${toolUse.id}`,
              () => applyResolution(run, prepared.itemId, decision),
              DB_STEP_RETRY,
            );
            if (decision === 'cancel') {
              cancelled = true;
              break;
            }
            if (decision === 'decline') {
              open.answered.push({
                toolUseId: toolUse.id,
                toolName: toolUse.name,
                content: DECLINED_RESULT,
                isError: true,
              });
              continue;
            }
          }

          const result = await ctx.run(
            `tool-${toolUse.id}`,
            () => executeToolCall(run, toolUse, prepared.itemId),
            DB_STEP_RETRY,
          );
          open.answered.push(result);
        }

        const answered = open;
        if (cancelled) {
          await ctx.run(
            'cancelled',
            async () => {
              await closeToolLoop(providerFor(run), run, answered.toolUses, answered.answered, toolResultsTranscriptKey(run.runId, step), CANCELLED_RESULT);
              await finishRun(runRef(run), 'cancelled');
            },
            DB_STEP_RETRY,
          );
          return;
        }
        await ctx.run(
          `tool-results-${step}`,
          () => closeToolLoop(providerFor(run), run, answered.toolUses, answered.answered, toolResultsTranscriptKey(run.runId, step), CANCELLED_RESULT),
          DB_STEP_RETRY,
        );
        open = null;

        const stopRequested = await ctx.run(
          `stop-check-${step}`,
          async () => Boolean((await store.findRun(db, run.runId))?.stopRequestedAt),
          DB_STEP_RETRY,
        );
        if (stopRequested) {
          await ctx.run('cancelled', () => finishRun(runRef(run), 'cancelled'), DB_STEP_RETRY);
          return;
        }
      }

      await ctx.run(
        'step-limit',
        () =>
          finishRun(runRef(run), 'failed', {
            code: 'step_limit',
            message: 'The assistant stopped after too many steps. Try a narrower request.',
          }),
        DB_STEP_RETRY,
      );
    } catch (error) {
      if (!(error instanceof restate.TerminalError)) throw error;
      const unanswered = open;
      await ctx.run(
        'failed',
        async () => {
          if (unanswered) {
            await closeToolLoop(providerFor(run), run, unanswered.toolUses, unanswered.answered, interruptedTranscriptKey(run.runId), 'This action did not run because the assistant hit an error.');
          }
          await finishRun(runRef(run), 'failed', readRunFailure(error));
        },
        DB_STEP_RETRY,
      );
    }
  }

  return processRun;
}

export function createAssistantConversationObject(deps: AssistantConversationDeps) {
  const processRun = createRunProcessor(deps);
  return restate.object({
    name: ASSISTANT_CONVERSATION_OBJECT,
    handlers: {
      processRun: (ctx: restate.ObjectContext, input: ProcessRunInput) => processRun(ctx, input),
    } satisfies Record<keyof AssistantConversationHandlers, unknown>,
    options: {
      // Only the signed `AssistantControl` service starts a turn (control.ts).
      ingressPrivate: true,
      // A model step can stream for minutes; approvals suspend instead.
      inactivityTimeout: 10 * 60_000,
      abortTimeout: 10 * 60_000,
    },
  });
}
