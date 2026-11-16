/**
 * The seam between a voice session and the model that listens and speaks
 * (after `runtime/providers/types.ts`, which does the same for the text
 * agent). The session only sees neutral events: audio, what was heard and
 * said, tool calls, usage. Everything provider-specific stays in the adapter:
 * the connection, its message format, how a session is resumed, how usage is
 * split by modality.
 *
 * A voice provider is not a `ModelProvider`: it never runs the agent loop and
 * never touches a conversation's transcript. It is a speaking front for
 * whichever text provider the conversation runs on.
 */

/** Token usage of one reply of the voice model, split by what each token is billed as. */
export type VoiceUsage = {
  textInputTokens: number;
  audioInputTokens: number;
  textOutputTokens: number;
  audioOutputTokens: number;
};

/** A tool the voice model may call, declared in JSON Schema. */
export type VoiceToolDeclaration = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type VoiceToolCall = { id: string; name: string; args: unknown };

/**
 * When the voice model should speak about a tool's result:
 * - `when_idle`: after it finishes what it is saying now.
 * - `interrupt`: now, cutting off what it is saying.
 * - `silent`: never on its own; it only knows the result.
 */
export type VoiceResultDelivery = 'when_idle' | 'interrupt' | 'silent';

export type VoiceEvent =
  /** A piece of the assistant's voice: 16-bit little-endian mono PCM at the output rate. */
  | { type: 'audio'; pcm: Uint8Array }
  /** The provider heard the user start (`true`) or stop (`false`) speaking. */
  | { type: 'user_speaking'; speaking: boolean }
  /** More of what the user said; `finished` once the utterance is complete. */
  | { type: 'heard'; text: string; finished: boolean }
  /** More of what the assistant is saying. */
  | { type: 'said'; text: string }
  /** The assistant finished its reply. */
  | { type: 'reply_done' }
  /** The user spoke over the assistant; its unfinished reply is dropped. */
  | { type: 'interrupted' }
  | { type: 'tool_calls'; calls: VoiceToolCall[] }
  /** The model no longer waits for these calls (the user moved on); a result sent for them is ignored. */
  | { type: 'tool_calls_cancelled'; ids: string[] }
  /** The usage of the reply that just ended, with the model that answered when the provider says. */
  | { type: 'usage'; usage: VoiceUsage }
  /** A handle that resumes this session on a new connection (the latest one wins). */
  | { type: 'resume_handle'; handle: string }
  /** The provider will close this connection soon; the session should reconnect. */
  | { type: 'going_away' }
  /** The connection closed. `expected` when the session closed it itself. */
  | { type: 'closed'; expected: boolean; detail: string };

/** One open connection to the voice model. Every method is a no-op once it is closed. */
export type VoiceConnection = {
  /** Microphone audio: 16-bit little-endian mono PCM at the input rate. */
  sendAudio(pcm: Uint8Array): void;
  /** The microphone stream paused (the user muted): what was heard so far is complete. */
  endAudio(): void;
  /**
   * Answers a tool call. `final: false` is news about a call that is still
   * running (a change waiting for the user's approval): the model speaks about
   * it and keeps waiting for the final result.
   */
  sendToolResult(result: { id: string; name: string; output: Record<string, unknown>; delivery: VoiceResultDelivery; final: boolean }): void;
  /** A message from the app itself (not the user's voice), which the model answers aloud. */
  sendNote(text: string): void;
  close(): void;
};

export type VoiceConnectInput = {
  instructions: string;
  tools: readonly VoiceToolDeclaration[];
  /** A handle from an earlier connection of this session, to continue it; null starts fresh. */
  resumeHandle: string | null;
  onEvent: (event: VoiceEvent) => void;
};

export type VoiceProvider = {
  /** Whose prices and console the cost rows belong to (`assistant_model_request.provider`). */
  id: 'gemini';
  /** The model sessions are opened on (`requested_model` of their cost rows). */
  model: string;
  /** Opens a connection; rejects when the model cannot be reached or refuses the setup. */
  connect(input: VoiceConnectInput): Promise<VoiceConnection>;
};
