import { ASSISTANT_TERMINAL_RUN_STATUSES } from '@campuspilot/assistant-contract/dto';
import type { Logger } from '@campuspilot/logger';
import * as restate from '@restatedev/restate-sdk';

import { db } from '../db/client';
import type { AssistantToolCallBody, AssistantUserMessageBody } from '../db/schema';
import { isAssistantRunStopSignalled, publishAssistantEvent, rememberStreamingText } from '../events';
import { createTextRelease } from './text-release';
import { getRunToken } from '../platform';
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

import { callTool, loadToolCatalog, requiresApproval, toModelToolName } from './tools';

/** Model requests one run may make before it stops to protect against loops. */
const MAX_MODEL_STEPS = 20;

const MODEL_STEP_RETRY = { maxRetryAttempts: 3, initialRetryInterval: 2_000 };
const DB_STEP_RETRY = { maxRetryAttempts: 5, initialRetryInterval: 500 };

const DECLINED_RESULT = 'The user declined this action. Do not retry it; ask what they would like instead.';
const CANCELLED_RESULT = 'The user stopped the assistant before this action ran.';

export type AssistantConversationDeps = {
  providers: ProviderRegistry;
  log: Logger;
};

/**
 * A run failure with an explicit code. Restate replays terminal errors with
 * their message only, so the code travels inside it as JSON.
 */
function runFailure(code: string, message: string) {
  return new restate.TerminalError(JSON.stringify({ code, message }));
}

function readRunFailure(error: restate.TerminalError): { code: string; message: string } {
  try {
    const parsed = JSON.parse(error.message) as { code?: unknown; message?: unknown };
    if (typeof parsed.code === 'string' && typeof parsed.message === 'string') {
      return { code: parsed.code, message: parsed.message };
    }
  } catch {
    // Not one of ours (for example ctx.run giving up after its retries).
  }
  return {
    code: 'model_error',
    message: 'The assistant could not finish this request. Please try again.',
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

async function finishRun(
  run: { id: string; conversationId: string },
  status: 'completed' | 'failed' | 'cancelled',
  error?: { code: string; message: string },
) {
  await tx(async (t, emit) => {
    await store.completeStreamingItems(t, emit, run);
    await store.updateRun(t, emit, run, {
      status,
      completedAt: new Date(),
      ...(error ? { errorCode: error.code, errorMessage: error.message } : {}),
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

export function createAssistantConversationObject(deps: AssistantConversationDeps) {
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
      await store.updateRun(t, emit, run, {
        status: 'running',
        startedAt: run.startedAt ?? new Date(),
        provider: provider.id,
        model: conversation.model,
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
        today: new Date().toISOString().slice(0, 10),
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
      const schools = JSON.parse(outcome.storedOutput) as Array<{ id: string; name: string }>;
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
      deps.log.error({ err: error, runId: run.runId, step, provider: provider.id }, 'assistant.model.error');
      if (provider.isPermanentError(error)) {
        throw runFailure(
          'model_rejected',
          'The assistant could not process this request. Please try rephrasing it.',
        );
      }
      throw error;
    }

    if (result.stopped) {
      const text = result.text;
      if (text) {
        const item = await ensureItem();
        await tx(async (t, emit) => {
          await store.updateItem(t, emit, item, { status: 'complete', body: { text } });
          await store.appendTranscriptEntry(t, {
            conversationId: run.conversationId,
            runId: run.runId,
            role: 'assistant',
            content: provider.assistantTextContent(text),
            entryKey,
          });
        });
      }
      return { kind: 'stopped' };
    }

    const text = result.text || (result.refusal ? 'I can’t help with that request.' : '');
    const item = text ? await ensureItem() : itemPromise ? await itemPromise : null;
    await tx(async (t, emit) => {
      if (item) {
        await store.updateItem(t, emit, item, { status: 'complete', body: { text } });
      }
      await store.appendTranscriptEntry(t, {
        conversationId: run.conversationId,
        runId: run.runId,
        role: 'assistant',
        content: result.content,
        entryKey,
      });
      await store.updateRun(t, emit, runRef(run), {}, result.usage);
    });

    return { kind: 'response', toolUses: result.toolUses, paused: result.paused };
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
   * stopped first, in which case nothing waits.
   */
  async function requestApproval(
    run: RunFacts,
    itemId: string,
    toolName: string,
    awakeableId: string,
  ): Promise<boolean> {
    const current = await store.findRun(db, run.runId);
    if (!current || current.stopRequestedAt) return false;
    await tx(async (t, emit) => {
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
    });
    return true;
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

  async function executeToolCall(
    run: RunFacts,
    toolUse: ToolUse,
    itemId: string,
  ): Promise<ModelToolResult> {
    const token = await requireToken(run.runId);
    const catalog = await loadToolCatalog(token);
    const tool = catalog.tools.get(toolUse.name)!;
    const outcome = await callTool(token, tool, toolUse.input ?? {});
    if (!outcome.ok) {
      deps.log.info({ runId: run.runId, tool: tool.mcpName, code: outcome.error.code }, 'assistant.tool.failed');
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

  async function processRun(ctx: restate.ObjectContext, input: ProcessRunInput) {
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

  return restate.object({
    name: ASSISTANT_CONVERSATION_OBJECT,
    handlers: { processRun } satisfies Record<keyof AssistantConversationHandlers, unknown>,
    options: {
      // A model step can stream for minutes; approvals suspend instead.
      inactivityTimeout: 10 * 60_000,
      abortTimeout: 10 * 60_000,
    },
  });
}
