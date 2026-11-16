import { MediaModality, type LiveServerMessage } from '@google/genai';
import { describe, expect, it } from 'vitest';

import { voiceEventsOf, voiceUsageOf } from './gemini-live';

/** A server message as the SDK delivers it, from its plain JSON. */
const message = (json: object) => json as LiveServerMessage;

describe('voiceUsageOf', () => {
  it('bills what the provider names as audio as audio, and the rest of the totals as text', () => {
    // A real reply of gemini-3.8-live: the prompt list (390 + 308) is less than the total (749).
    expect(
      voiceUsageOf({
        promptTokenCount: 749,
        responseTokenCount: 89,
        thoughtsTokenCount: 90,
        promptTokensDetails: [
          { modality: MediaModality.TEXT, tokenCount: 390 },
          { modality: MediaModality.AUDIO, tokenCount: 308 },
        ],
        responseTokensDetails: [{ modality: MediaModality.AUDIO, tokenCount: 89 }],
      }),
    ).toEqual({ textInputTokens: 441, audioInputTokens: 308, textOutputTokens: 90, audioOutputTokens: 89 });
  });

  it('counts a tool call and its thinking as text output', () => {
    expect(voiceUsageOf({ promptTokenCount: 100, responseTokenCount: 21, thoughtsTokenCount: 118 })).toEqual({
      textInputTokens: 100,
      audioInputTokens: 0,
      textOutputTokens: 139,
      audioOutputTokens: 0,
    });
  });

  it('adds tool results to the text input', () => {
    expect(voiceUsageOf({ promptTokenCount: 10, toolUsePromptTokenCount: 5 }).textInputTokens).toBe(15);
  });
});

describe('voiceEventsOf', () => {
  it('reads speech start and end from the field the model sends', () => {
    expect(voiceEventsOf(message({ voiceActivity: { type: 'ACTIVITY_START' } }))).toEqual([{ type: 'user_speaking', speaking: true }]);
    expect(voiceEventsOf(message({ voiceActivity: { voiceActivityType: 'ACTIVITY_END' } }))).toEqual([{ type: 'user_speaking', speaking: false }]);
  });

  it('decodes audio and keeps what was said next to it', () => {
    const pcm = Buffer.from([1, 2, 3, 4]);
    const events = voiceEventsOf(
      message({
        serverContent: {
          modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: pcm.toString('base64') } }] },
          outputTranscription: { text: 'Class 8-B ' },
        },
      }),
    );
    expect(events).toEqual([
      { type: 'audio', pcm },
      { type: 'said', text: 'Class 8-B ' },
    ]);
  });

  it('reports usage before the reply ends, so the cost is saved under that reply', () => {
    const events = voiceEventsOf(message({ serverContent: { turnComplete: true }, usageMetadata: { promptTokenCount: 5 } }));
    expect(events.map((event) => event.type)).toEqual(['usage', 'reply_done']);
  });

  it('passes tool calls, their cancellation, a resume handle and the warning before a close', () => {
    expect(voiceEventsOf(message({ toolCall: { functionCalls: [{ id: 'c1', name: 'ask_assistant', args: { request: 'x' } }] } }))).toEqual([
      { type: 'tool_calls', calls: [{ id: 'c1', name: 'ask_assistant', args: { request: 'x' } }] },
    ]);
    expect(voiceEventsOf(message({ toolCallCancellation: { ids: ['c1'] } }))).toEqual([{ type: 'tool_calls_cancelled', ids: ['c1'] }]);
    expect(voiceEventsOf(message({ sessionResumptionUpdate: { resumable: true, newHandle: 'h1' } }))).toEqual([{ type: 'resume_handle', handle: 'h1' }]);
    expect(voiceEventsOf(message({ sessionResumptionUpdate: { resumable: false } }))).toEqual([]);
    expect(voiceEventsOf(message({ goAway: { timeLeft: '5s' } }))).toEqual([{ type: 'going_away' }]);
  });

  it('drops the unfinished reply before any audio of the same message', () => {
    const events = voiceEventsOf(message({ serverContent: { interrupted: true, inputTranscription: { text: 'wait' } } }));
    expect(events).toEqual([
      { type: 'heard', text: 'wait', finished: false },
      { type: 'interrupted' },
    ]);
  });
});
