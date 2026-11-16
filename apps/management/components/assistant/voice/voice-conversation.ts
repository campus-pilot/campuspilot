/**
 * The conversation one voice session speaks in, as plain logic so its two
 * rules are tested without a chat or a microphone.
 *
 * A session's spoken requests go into one conversation: the one it started in,
 * or the one its first request starts. Two rules follow:
 *
 * - Requests are sent one after another. The second request of a session may
 *   be spoken while the first is still on its way (a slow network, a retry);
 *   sent side by side, both would find no conversation yet and each would
 *   start its own, and the user would see only one of them. Only the sending
 *   is in order (a few hundred milliseconds); the assistant's work on them is
 *   not waited for.
 * - A request that could not be sent holds nothing up: the next one is sent
 *   as if it were the first.
 */

/** The conversation and run a sent request belongs to. */
export type VoiceTurn = { conversationId: string; runId: string };

export type VoiceConversation = {
  /**
   * Sends `request` with `send` into the session's conversation, after every
   * earlier request of the session has been sent. `onStarted` is called once,
   * when a request started the conversation.
   */
  send: (request: string, send: (request: string, conversationId: string | null) => Promise<VoiceTurn>, onStarted: (conversationId: string) => void) => Promise<VoiceTurn>;
};

/** A session's conversation: `conversationId` when it continues one, null when its first request starts one. */
export function createVoiceConversation(conversationId: string | null): VoiceConversation {
  let current = conversationId;
  let earlier: Promise<unknown> = Promise.resolve();
  return {
    send(request, send, onStarted) {
      const sent = earlier.then(async () => {
        const turn = await send(request, current);
        if (!current) {
          current = turn.conversationId;
          onStarted(turn.conversationId);
        }
        return turn;
      });
      earlier = sent.catch(() => undefined);
      return sent;
    },
  };
}
