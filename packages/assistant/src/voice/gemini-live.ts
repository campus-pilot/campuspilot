import {
  Behavior,
  FunctionResponseScheduling,
  GoogleGenAI,
  MediaModality,
  Modality,
  type LiveServerMessage,
  type Session,
  type UsageMetadata,
} from '@google/genai';
import { VOICE_INPUT_SAMPLE_RATE } from '@campuspilot/assistant-contract/voice';

import { GEMINI_API_VERSION } from '../runtime/providers/gemini-api-version';
import type { VoiceSettings } from './config';
import type { VoiceConnectInput, VoiceConnection, VoiceEvent, VoiceProvider, VoiceResultDelivery, VoiceUsage } from './provider';

/**
 * The Gemini Live adapter: one WebSocket to the Live API per connection,
 * through the official SDK. Facts it relies on were read from the model's own
 * answers (`gemini-3.8-live`, November 2026):
 * - Audio arrives as base64 `inlineData` parts; what was said arrives as text
 *   deltas next to it; what the user said arrives once, when they stop.
 * - `voiceActivity` marks where the server heard speech start and end.
 * - `usageMetadata` arrives once per reply, with `turnComplete`.
 * - `turnComplete` arrives when the reply's audio would have finished playing
 *   in real time, a few seconds after the last audio was sent.
 * - A `sessionResumptionUpdate` with a handle arrives right after setup and
 *   again as the session moves on; a connection lasts about ten minutes
 *   (`goAway` warns before it ends).
 */

const SCHEDULING: Record<VoiceResultDelivery, FunctionResponseScheduling> = {
  when_idle: FunctionResponseScheduling.WHEN_IDLE,
  interrupt: FunctionResponseScheduling.INTERRUPT,
  silent: FunctionResponseScheduling.SILENT,
};

const INPUT_MIME_TYPE = `audio/pcm;rate=${VOICE_INPUT_SAMPLE_RATE}`;

/**
 * One reply's usage split by what each token is billed as.
 *
 * The provider lists the prompt by modality, but the list does not always add
 * up to `promptTokenCount` (tool declarations and tool results are counted in
 * the total only). So audio is what it names as audio, and text is the rest of
 * the total: nothing billed is left out. Thinking tokens are billed as text
 * output; so is a tool call, which has no modality entry.
 */
export function voiceUsageOf(usage: UsageMetadata): VoiceUsage {
  const audioOf = (details: UsageMetadata['promptTokensDetails']) =>
    (details ?? []).filter((entry) => entry.modality === MediaModality.AUDIO).reduce((sum, entry) => sum + (entry.tokenCount ?? 0), 0);
  const audioInputTokens = audioOf(usage.promptTokensDetails);
  const audioOutputTokens = audioOf(usage.responseTokensDetails);
  const promptTokens = (usage.promptTokenCount ?? 0) + (usage.toolUsePromptTokenCount ?? 0);
  const responseTokens = (usage.responseTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
  return {
    textInputTokens: Math.max(0, promptTokens - audioInputTokens),
    audioInputTokens,
    textOutputTokens: Math.max(0, responseTokens - audioOutputTokens),
    audioOutputTokens,
  };
}

/** The neutral events of one server message, in the order they should be handled. */
export function voiceEventsOf(message: LiveServerMessage): VoiceEvent[] {
  const events: VoiceEvent[] = [];
  const content = message.serverContent;
  // The SDK types name the field `voiceActivityType`; the model's messages carry it as `type`.
  const activity = message.voiceActivity as { voiceActivityType?: string; type?: string } | undefined;
  const activityType = activity?.voiceActivityType ?? activity?.type;
  if (activityType === 'ACTIVITY_START') events.push({ type: 'user_speaking', speaking: true });
  if (activityType === 'ACTIVITY_END') events.push({ type: 'user_speaking', speaking: false });
  if (content?.inputTranscription?.text) {
    events.push({ type: 'heard', text: content.inputTranscription.text, finished: content.inputTranscription.finished ?? false });
  }
  if (content?.interrupted) events.push({ type: 'interrupted' });
  for (const part of content?.modelTurn?.parts ?? []) {
    if (part.inlineData?.data && part.inlineData.mimeType?.startsWith('audio/pcm')) {
      events.push({ type: 'audio', pcm: Buffer.from(part.inlineData.data, 'base64') });
    }
  }
  if (content?.outputTranscription?.text) events.push({ type: 'said', text: content.outputTranscription.text });
  const calls = message.toolCall?.functionCalls ?? [];
  if (calls.length > 0) {
    events.push({ type: 'tool_calls', calls: calls.map((call) => ({ id: call.id ?? '', name: call.name ?? '', args: call.args ?? {} })) });
  }
  const cancelled = message.toolCallCancellation?.ids ?? [];
  if (cancelled.length > 0) events.push({ type: 'tool_calls_cancelled', ids: cancelled });
  if (message.usageMetadata) events.push({ type: 'usage', usage: voiceUsageOf(message.usageMetadata) });
  if (content?.turnComplete) events.push({ type: 'reply_done' });
  const resumption = message.sessionResumptionUpdate;
  if (resumption?.resumable && resumption.newHandle) events.push({ type: 'resume_handle', handle: resumption.newHandle });
  if (message.goAway) events.push({ type: 'going_away' });
  return events;
}

/** The Live API session config of one connection. */
function liveConfig(settings: VoiceSettings, input: VoiceConnectInput) {
  return {
    responseModalities: [Modality.AUDIO],
    systemInstruction: input.instructions,
    tools: [
      {
        functionDeclarations: input.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parametersJsonSchema: tool.parameters,
          // The model keeps listening while a call runs: a lookup takes many seconds, and the user may speak meanwhile.
          behavior: Behavior.NON_BLOCKING,
        })),
      },
    ],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    sessionResumption: input.resumeHandle ? { handle: input.resumeHandle } : {},
    // Without compression an audio session ends at fifteen minutes; with it the oldest turns slide out.
    contextWindowCompression: { slidingWindow: {} },
    ...(settings.voiceName ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: settings.voiceName } } } } : {}),
  };
}

/**
 * How long a connection may take to be ready. The SDK's `live.connect` waits
 * for the socket to open and for the model's setup to complete, and neither
 * wait ever fails: a socket that closes first (a wrong model name, a key
 * without access, a network that drops) would leave it waiting for ever, and
 * the user on "Connecting". So the wait is given an end here.
 */
export const VOICE_CONNECT_TIMEOUT_MS = 15_000;

export function createGeminiLiveProvider(settings: VoiceSettings): VoiceProvider {
  const client = new GoogleGenAI({ apiKey: settings.apiKey, apiVersion: GEMINI_API_VERSION });

  return {
    id: 'gemini',
    model: settings.model,
    async connect(input: VoiceConnectInput): Promise<VoiceConnection> {
      let closedByUs = false;
      let open = true;
      /** Whether the connection became ready; before that a close is a failed connect, not a dropped session. */
      let ready = false;
      /** Whether the connect failed or timed out: whatever this connection still delivers is nobody's. */
      let abandoned = false;
      let failConnect: (error: Error) => void = () => undefined;
      const failed = new Promise<never>((_resolve, reject) => {
        failConnect = reject;
      });
      // A failure after the connect was already decided has nobody waiting for it.
      failed.catch(() => undefined);
      const timeout = setTimeout(() => failConnect(new Error(`The voice model was not ready within ${VOICE_CONNECT_TIMEOUT_MS / 1000} s.`)), VOICE_CONNECT_TIMEOUT_MS);
      const connecting = client.live.connect({
        model: settings.model,
        config: liveConfig(settings, input),
        callbacks: {
          onmessage: (message) => {
            // A connection that was given up on has no session to tell.
            if (abandoned) return;
            // The SDK calls this from its socket: anything thrown here would reach the server's event loop.
            let events: VoiceEvent[];
            try {
              events = voiceEventsOf(message);
            } catch {
              // A message that cannot be read leaves the session's state unknown: treat the connection as lost, so it is replaced.
              events = [{ type: 'closed', expected: false, detail: 'unreadable message from the voice model' }];
            }
            for (const event of events) input.onEvent(event);
          },
          onerror: (event) => {
            // The close that follows reports it; an error alone does not end the connection.
            void event;
          },
          onclose: (event) => {
            open = false;
            const detail = `${event.code} ${event.reason}`.trim();
            if (abandoned) return;
            if (!ready) return failConnect(new Error(`The voice model closed the connection before it was ready: ${detail}`));
            input.onEvent({ type: 'closed', expected: closedByUs, detail });
          },
        },
      });
      let session: Session;
      try {
        session = await Promise.race([connecting, failed]);
      } catch (err) {
        abandoned = true;
        // A connection that becomes ready after it was given up on has no owner: close it, so it is not left open and billed.
        void connecting.then((late) => late.close()).catch(() => undefined);
        throw err;
      } finally {
        clearTimeout(timeout);
      }
      ready = true;

      return {
        sendAudio(pcm) {
          if (!open) return;
          session.sendRealtimeInput({ audio: { data: Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).toString('base64'), mimeType: INPUT_MIME_TYPE } });
        },
        endAudio() {
          if (open) session.sendRealtimeInput({ audioStreamEnd: true });
        },
        sendToolResult(result) {
          if (!open) return;
          session.sendToolResponse({
            functionResponses: [
              { id: result.id, name: result.name, response: result.output, scheduling: SCHEDULING[result.delivery], willContinue: !result.final },
            ],
          });
        },
        sendNote(text) {
          if (open) session.sendClientContent({ turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true });
        },
        close() {
          if (!open) return;
          closedByUs = true;
          open = false;
          session.close();
        },
      };
    },
  };
}
