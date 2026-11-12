import { useState } from 'react';

/**
 * What decides the React key of the chat a surface shows.
 * - `shown`: the conversation the chat showed at the last render (null for a new one).
 * - `started`: the conversation the mounted new-conversation chat started with its first message, if any.
 * - `generation`: counts the new-conversation chats, so each one gets a key no earlier chat had.
 */
export type ChatKeyState = { shown: string | null; started: string | null; generation: number };

export const INITIAL_CHAT_KEY_STATE: ChatKeyState = { shown: null, started: null, generation: 0 };

/**
 * The state once the surface shows `conversationId`. The arrival in the
 * conversation the chat itself started keeps everything, so that chat stays
 * mounted. Any other change (another conversation, back to a new one) is a
 * different chat: it forgets the started conversation and moves to the next
 * generation, so a new conversation never reuses the key of the chat before
 * it. Returns `state` itself when nothing changed.
 */
export function nextChatKeyState(state: ChatKeyState, conversationId: string | null): ChatKeyState {
  if (conversationId === state.shown) return state;
  if (conversationId !== null && conversationId === state.started) return { ...state, shown: conversationId };
  return { shown: conversationId, started: null, generation: state.generation + 1 };
}

/** The chat's key in `state`: a new conversation and the one it started share a key; any other conversation is keyed by its id. */
export function chatKeyOf(state: ChatKeyState): string {
  return state.shown === null || state.shown === state.started ? `new:${state.generation}` : state.shown;
}

/**
 * The key for the chat showing `conversationId`, and `started`, which the
 * surface calls when that chat's first message started a conversation,
 * before (or with) the change that shows it.
 *
 * A chat that starts a conversation stays mounted as it moves into it:
 * remounting would blank the conversation until its first snapshot arrives,
 * drop the focus and whatever was typed after sending, and restart the
 * stream. Every other change of conversation remounts, so a chat never
 * carries one conversation's state into another.
 *
 * The change is noted while rendering (React's "adjusting state when a prop
 * changes"), not in an effect, so the key is right in the very render that
 * shows the new conversation.
 */
export function useChatKey(conversationId: string | null) {
  const [state, setState] = useState(INITIAL_CHAT_KEY_STATE);
  const next = nextChatKeyState(state, conversationId);
  if (next !== state) setState(next);
  return {
    key: chatKeyOf(next),
    started: (id: string) => setState((current) => ({ ...current, started: id })),
  };
}
