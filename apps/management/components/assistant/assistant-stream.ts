import { ORPCError } from '@orpc/client';

/**
 * Whether the service refused a request (a 4xx: not found, forbidden,
 * signed out). Asking again gives the same answer, so these are never
 * retried; network failures and server errors (5xx) are.
 */
export function isClientError(error: unknown): boolean {
  return error instanceof ORPCError && error.status < 500;
}

/**
 * Query retry for reads the assistant shows (records, results): a refusal is
 * final at once, anything else gets TanStack's usual three attempts.
 */
export function retryUnlessRefused(failureCount: number, error: unknown): boolean {
  return failureCount < 3 && !isClientError(error);
}

/**
 * The service's own explanation when it refused a request (its messages are
 * written for users), or null for a network or server failure, whose raw
 * text ("Failed to fetch") means nothing to a user: the caller then says
 * what could not be done in its own words.
 */
export function refusalMessage(error: unknown): string | null {
  return isClientError(error) && error instanceof Error && error.message ? error.message : null;
}

/** Why a conversation cannot be shown, in the terms the chat explains it. */
export type AssistantConversationFailure = 'signed_out' | 'unavailable';

/**
 * A missing conversation, one in another school and one the user may no
 * longer open all read the same to the user; only a lost session differs,
 * because signing in again fixes it.
 */
export function conversationFailure(error: unknown): AssistantConversationFailure {
  return error instanceof ORPCError && error.status === 401 ? 'signed_out' : 'unavailable';
}

export type ReconnectingStreamOptions<TEvent> = {
  /** Opens one connection. Called again for every reconnect, so it reads the resume cursor each time. */
  subscribe: (signal: AbortSignal) => Promise<AsyncIterable<TEvent>>;
  /** Waits before reconnect number `attempt` (from 0). Must settle when the signal aborts. */
  delay: (attempt: number, signal: AbortSignal) => Promise<void>;
  /** Whether an event means the connection has caught up, which resets the backoff. */
  isSynchronized: (event: TEvent) => boolean;
  /** Whether a failure is final: it is thrown instead of reconnecting. */
  isFinal: (error: unknown) => boolean;
  /** Called each time a connection is lost, before waiting to reconnect. */
  onDisconnect: () => void;
  /** Ends the stream: the consumer has gone. */
  signal: AbortSignal;
};

/**
 * One endless stream over many connections. When a connection ends (cleanly
 * or with a retryable failure) it reports the drop, waits and subscribes
 * again; the consumer just keeps receiving events.
 *
 * The backoff counts consecutive drops and resets once a connection has
 * caught up, so one blip does not slow every later reconnect. A connection
 * that never catches up keeps backing off. A final failure is thrown, so the
 * consumer can show it; an abort ends the stream quietly.
 */
export async function* reconnectingStream<TEvent>({
  subscribe,
  delay,
  isSynchronized,
  isFinal,
  onDisconnect,
  signal,
}: ReconnectingStreamOptions<TEvent>): AsyncGenerator<TEvent, void, undefined> {
  let attempt = 0;
  while (!signal.aborted) {
    try {
      for await (const event of await subscribe(signal)) {
        if (signal.aborted) return;
        if (isSynchronized(event)) attempt = 0;
        yield event;
      }
    } catch (error) {
      if (signal.aborted) return;
      if (isFinal(error)) throw error;
    }
    if (signal.aborted) return;
    onDisconnect();
    await delay(attempt, signal);
    attempt += 1;
  }
}
