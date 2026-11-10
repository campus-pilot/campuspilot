import type { AssistantUserMessageBody } from '../../db/schema';
import type { AssistantPrompt } from '../prompt';
import type { ProviderRegistry } from './registry';
import type {
  ModelFailureKind,
  ModelProvider,
  ModelProviderId,
  ModelStepInput,
  ModelStepResult,
  ModelToolResult,
  ModelToolUse,
  ModelUsage,
  TranscriptEntry,
} from './types';

/**
 * A scripted `ModelProvider` for tests. It never reaches a model: every
 * `step` answers with the next entry of a script, and records what it was
 * asked, so a test can assert both what the loop does with a response and
 * what the loop sent to get it.
 *
 * The transcript format is the fake's own (see the block types below), on
 * purpose not Claude's or Gemini's: the loop must work through the
 * `ModelProvider` mappers only, so a test that passes with this format shows
 * the loop does not depend on a real provider's content shape.
 */

export type FakeTextBlock = { type: 'text'; text: string };
export type FakeToolUseBlock = { type: 'tool_use'; id: string; name: string; input: unknown };
export type FakeToolResultBlock = { type: 'tool_result' } & ModelToolResult;
export type FakeBlock = FakeTextBlock | FakeToolUseBlock | FakeToolResultBlock;

/** A response that was not stopped, as the fake's script holds it. */
export type FakeReply = Extract<ModelStepResult, { stopped: false }>;

/**
 * A provider error with the failure kind the fake reports for it. Throw (or
 * script) a plain `Error` instead to get `unknown`, as a real adapter does
 * for an error it does not recognise.
 */
export class FakeModelError extends Error {
  constructor(
    readonly kind: ModelFailureKind,
    message: string,
  ) {
    super(message);
    this.name = 'FakeModelError';
  }
}

/**
 * One scripted `step`:
 * - a result, returned as is;
 * - an `Error`, thrown (a `FakeModelError` to choose its failure kind);
 * - a function, for a step that reads its input or streams text through
 *   `input.onText` before answering. `call` is the 0-based index of this
 *   `step` call on the provider.
 */
export type FakeModelStep =
  | ModelStepResult
  | Error
  | ((input: ModelStepInput, call: number) => ModelStepResult | Promise<ModelStepResult>);

/** What one `step` call received, copied so later changes cannot alter it. */
export type FakeModelCall = {
  prompt: AssistantPrompt;
  /** Model-facing names of the tools offered, in the order given. */
  toolNames: string[];
  transcript: TranscriptEntry[];
};

export type FakeModelProvider = ModelProvider & {
  /** Every `step` call so far, in order, including calls that threw. */
  readonly calls: readonly FakeModelCall[];
  /** Appends steps to the script. */
  enqueue: (...steps: FakeModelStep[]) => void;
  /** Scripted steps not consumed yet. */
  remaining: () => number;
};

export const FAKE_USAGE: ModelUsage = {
  inputTokens: 100,
  outputTokens: 20,
  cacheReadInputTokens: 30,
  cacheCreationInputTokens: 5,
};

/** The model a fake reply reports unless the test names one. */
export const FAKE_REPORTED_MODEL = 'fake-reported-model';

/**
 * Builds a reply whose `content` matches its `text` and `toolUses`, the way
 * a real adapter's response does: a text block, then one block per call.
 */
export function fakeReply({
  text = '',
  toolUses = [],
  model = FAKE_REPORTED_MODEL,
  usage = FAKE_USAGE,
  refusal = false,
  paused = false,
}: {
  text?: string;
  toolUses?: ModelToolUse[];
  model?: string;
  usage?: ModelUsage;
  refusal?: boolean;
  paused?: boolean;
} = {}): FakeReply {
  const content: FakeBlock[] = [
    ...(text ? [{ type: 'text' as const, text }] : []),
    ...toolUses.map((toolUse) => ({ type: 'tool_use' as const, ...toolUse })),
  ];
  return { stopped: false, text, refusal, paused, toolUses, content, model, usage };
}

/**
 * A step that streams before it answers: `snapshots` are passed to `onText`
 * in order, each the accumulated visible text so far, as adapters report it.
 */
export function fakeStreamed(snapshots: readonly string[], result: ModelStepResult): FakeModelStep {
  return (input) => {
    for (const snapshot of snapshots) input.onText(snapshot);
    return result;
  };
}

export function createFakeProvider({
  id = 'anthropic',
  model = 'fake-configured-model',
  script = [],
  whenExhausted,
}: {
  /** A real provider id: conversations and runs store it in an enum column. */
  id?: ModelProviderId;
  /** The model the provider is "configured" with (`ModelProvider.model`). */
  model?: string;
  script?: FakeModelStep[];
  /**
   * Answers every call after the script runs out (for a model that never
   * stops calling tools). Without it such a call throws, so a test that
   * makes more model requests than it scripted fails instead of hanging.
   */
  whenExhausted?: FakeModelStep;
} = {}): FakeModelProvider {
  const queue = [...script];
  const calls: FakeModelCall[] = [];

  return {
    id,
    model,
    calls,
    enqueue: (...steps) => void queue.push(...steps),
    remaining: () => queue.length,

    async step(input) {
      const call = calls.length;
      calls.push({
        prompt: { ...input.prompt },
        toolNames: input.tools.map((tool) => tool.modelName),
        transcript: structuredClone(input.transcript) as TranscriptEntry[],
      });
      const next = queue.length > 0 ? queue.shift() : whenExhausted;
      if (next === undefined) {
        throw new Error(`The fake model provider's script is exhausted (step call ${call + 1}).`);
      }
      if (next instanceof Error) throw next;
      return typeof next === 'function' ? next(input, call) : next;
    },

    userContent: (body: AssistantUserMessageBody): FakeBlock[] => [{ type: 'text', text: body.text }],
    assistantTextContent: (text: string): FakeBlock[] => [{ type: 'text', text }],
    toolResultsContent: (results: readonly ModelToolResult[]): FakeBlock[] =>
      results.map((result) => ({ type: 'tool_result', ...result })),
    toolUsesOf: (content: readonly unknown[]): ModelToolUse[] =>
      (content as readonly FakeBlock[]).flatMap((block) =>
        block.type === 'tool_use' ? [{ id: block.id, name: block.name, input: block.input }] : [],
      ),
    failureKind: (error: unknown): ModelFailureKind =>
      error instanceof FakeModelError ? error.kind : 'unknown',
  };
}

/** A registry holding only the given provider, as a turn's `deps.providers`. */
export function fakeProviderRegistry(provider: ModelProvider | null): ProviderRegistry {
  return {
    current: provider,
    unavailableReason: provider ? null : 'No provider is configured in this test.',
    get: (id) => (provider && provider.id === id ? provider : null),
  };
}
