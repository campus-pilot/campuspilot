import { useState, useTransition } from 'react';

/**
 * What decides the React key of the chat a surface shows.
 * - `shown`: the conversation the chat showed at the last render (null for a new one).
 * - `started`: the conversation the mounted new-conversation chat started with its first message, if any.
 * - `generation`: counts the new-conversation chats, so each one gets a key no earlier chat had.
 */
export type ChatKeyState = { shown: string | null; started: string | null; generation: number };

export const INITIAL_CHAT_KEY_STATE: ChatKeyState = { shown: null, started: null, generation: 0 };

/**
 * The state once the surface shows `conversationId`. `moving` is whether the
 * move to a started conversation is still under way.
 *
 * The arrival in the conversation the chat itself started keeps everything,
 * so that chat stays mounted. Any other change (another conversation, back
 * to a new one) is a different chat: it forgets the started conversation and
 * moves to the next generation, so a new conversation never reuses the key
 * of the chat before it.
 *
 * A move that ended without arriving was cancelled: on a page, a navigation
 * the user started meanwhile (a link to the new-conversation page itself)
 * replaces the pending one, so the address never changes. The chat, which
 * already shows the started conversation, then gets a new key too, so the
 * page, the history and the chat agree on a new conversation.
 *
 * Returns `state` itself when nothing changed.
 */
export function nextChatKeyState(state: ChatKeyState, conversationId: string | null, moving: boolean): ChatKeyState {
  const arrived = conversationId !== null && conversationId === state.started;
  if (conversationId !== state.shown && !arrived) return { shown: conversationId, started: null, generation: state.generation + 1 };
  if (state.started !== null && !arrived && !moving) return { shown: conversationId, started: null, generation: state.generation + 1 };
  return conversationId === state.shown ? state : { ...state, shown: conversationId };
}

/** The chat's key in `state`: a new conversation and the one it started share a key; any other conversation is keyed by its id. */
export function chatKeyOf(state: ChatKeyState): string {
  return state.shown === null || state.shown === state.started ? `new:${state.generation}` : state.shown;
}

/**
 * The key for the chat showing `conversationId`, and `started`, which the
 * surface calls when that chat's first message started conversation `id`,
 * with `move`, the update that shows it (a navigation, or a state change).
 *
 * A chat that starts a conversation stays mounted as it moves into it:
 * remounting would blank the conversation until its first snapshot arrives,
 * drop the focus and whatever was typed after sending, and restart the
 * stream. Every other change of conversation remounts, so a chat never
 * carries one conversation's state into another.
 *
 * `move` runs as a transition, and its pending flag says whether the move is
 * still under way: Next keeps a navigation's transition pending until it
 * renders, and one the user replaced with another navigation ends when that
 * one does. The change is noted while rendering (React's "adjusting state
 * when a prop changes"), not in an effect, so the key is right in the very
 * render that shows the outcome.
 */
export function useChatKey(conversationId: string | null) {
  const [moving, startMove] = useTransition();
  const [state, setState] = useState(INITIAL_CHAT_KEY_STATE);
  const next = nextChatKeyState(state, conversationId, moving);
  if (next !== state) setState(next);
  return {
    key: chatKeyOf(next),
    started: (id: string, move: () => void) => {
      setState((current) => ({ ...current, started: id }));
      startMove(move);
    },
  };
}
