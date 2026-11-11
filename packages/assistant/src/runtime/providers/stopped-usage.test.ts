import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';

import { streamAssistantResponse } from './anthropic';

/**
 * A stream that reports usage the way the Claude API does (`message_start`,
 * then `message_delta`) and is stopped before it finishes.
 */
function stoppedStream() {
  let emit: ((event: unknown) => void) | null = null;
  let fail: ((error: unknown) => void) | null = null;
  const final = new Promise<never>((_resolve, reject) => {
    fail = reject;
  });
  final.catch(() => {});
  const stream = {
    on(name: string, listener: (event: unknown) => void) {
      if (name === 'streamEvent') {
        emit = listener;
        queueMicrotask(() => {
          emit?.({
            type: 'message_start',
            message: {
              model: 'claude-test-20261101',
              usage: { input_tokens: 1200, output_tokens: 1, cache_read_input_tokens: 300, cache_creation_input_tokens: 40 },
            },
          });
          emit?.({ type: 'message_delta', delta: {}, usage: { output_tokens: 57 } });
        });
      }
      return stream;
    },
    abort() {
      fail?.(new Anthropic.APIUserAbortError());
    },
    finalMessage: () => final,
  };
  return { beta: { messages: { stream: () => stream } } } as unknown as Anthropic;
}

describe('a stopped Claude request', () => {
  it('returns the usage the stream had reported before the stop, and the answering model', async () => {
    const result = await streamAssistantResponse({
      client: stoppedStream(),
      model: 'claude-test',
      system: [],
      tools: [],
      messages: [],
      onText: () => {},
      isStopRequested: async () => true,
      stopPollIntervalMs: 5,
    });
    expect(result).toEqual({
      stopped: true,
      text: '',
      model: 'claude-test-20261101',
      partialUsage: { inputTokens: 1200, outputTokens: 57, cacheReadInputTokens: 300, cacheCreationInputTokens: 40 },
    });
  });
});
