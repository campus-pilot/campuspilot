import { ORPCError } from "@orpc/server";

/**
 * Server-sent progress for demo jobs and purges (oRPC event iterators, which
 * the RPC handler serves as `text/event-stream` with keep-alive comments).
 *
 * The status rows are polled, at most once per {@link WATCH_POLL_MS} per
 * stream, and a value is sent only when it changed. A stream ends when the
 * row is final, after {@link WATCH_MAX_MS} (the client reconnects) or when
 * the client disconnects: the request signal aborts the sleep at once and
 * oRPC then returns the generator, so no timer or query outlives the
 * connection. At most {@link MAX_WATCHERS} streams run per API process, which
 * bounds the polling load to that many small queries per second.
 */
export const WATCH_POLL_MS = 1_000;
export const WATCH_MAX_MS = 10 * 60 * 1000;
export const MAX_WATCHERS = 200;

let activeWatchers = 0;

/** Resolves after `ms`, or immediately once `signal` aborts. Never rejects. */
function pause(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** Yields `load()` whenever it changes, until `isFinal`, the time limit or disconnect. */
export async function* watchUntilFinal<T>(options: {
  load: () => Promise<T>;
  isFinal: (value: T) => boolean;
  signal?: AbortSignal;
}): AsyncGenerator<T, void, unknown> {
  if (activeWatchers >= MAX_WATCHERS) {
    throw new ORPCError("TOO_MANY_REQUESTS", { message: "Too many progress streams are open. Try again shortly." });
  }
  activeWatchers += 1;
  try {
    const deadline = Date.now() + WATCH_MAX_MS;
    let last: string | null = null;
    while (!options.signal?.aborted) {
      const value = await options.load();
      const serialized = JSON.stringify(value);
      if (serialized !== last) {
        last = serialized;
        yield value;
      }
      if (options.isFinal(value) || Date.now() >= deadline) return;
      await pause(WATCH_POLL_MS, options.signal);
    }
  } finally {
    activeWatchers -= 1;
  }
}
