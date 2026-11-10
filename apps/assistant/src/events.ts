import {
  assistantStreamEventSchema,
  type AssistantStreamEvent,
} from '@campuspilot/assistant-contract/dto';

import { connectedRedis, getRedis } from './redis';

/**
 * Live assistant events travel over Redis pub/sub so any assistant instance
 * can serve a conversation's stream while the run executes in whichever
 * instance Restate invoked. Pub/sub is fire-and-forget on purpose: Postgres is the
 * source of truth and every subscriber starts from a snapshot, so a missed
 * message costs at most one stale frame until the next upsert.
 */
const channel = (conversationId: string) =>
  `assistant:conversation:${conversationId}`;

/** Date fields of the stream DTOs, revived after the JSON round trip. */
const DATE_KEYS = new Set([
  'createdAt',
  'updatedAt',
  'startedAt',
  'completedAt',
  'stopRequestedAt',
]);

function reviveDates(_key: string, value: unknown) {
  return DATE_KEYS.has(_key) && typeof value === 'string' ? new Date(value) : value;
}

export async function publishAssistantEvent(
  conversationId: string,
  event: Exclude<AssistantStreamEvent, { type: 'snapshot' }>,
): Promise<void> {
  const client = await connectedRedis();
  await client.publish(channel(conversationId), JSON.stringify(event));
}

export type AssistantEventSubscription = {
  /** Resolves with the next event, or null once the subscription is closed. */
  next: () => Promise<AssistantStreamEvent | null>;
  close: () => Promise<void>;
};

/**
 * Subscribes before the caller reads its snapshot, so no change committed
 * after the snapshot can be missed. Events are buffered until consumed; the
 * buffer is bounded and a slow consumer is closed rather than allowed to
 * grow without limit (the client then reconnects and resyncs).
 */
export async function subscribeAssistantEvents(
  conversationId: string,
  { maxBuffered = 1000 }: { maxBuffered?: number } = {},
): Promise<AssistantEventSubscription> {
  const subscriber = getRedis().duplicate({ lazyConnect: true });
  await subscriber.connect();

  const buffer: AssistantStreamEvent[] = [];
  let waiting: ((event: AssistantStreamEvent | null) => void) | null = null;
  let closed = false;

  const close = async () => {
    if (closed) return;
    closed = true;
    waiting?.(null);
    waiting = null;
    subscriber.disconnect();
  };

  subscriber.on('message', (_channel: string, message: string) => {
    if (closed) return;
    const parsed = assistantStreamEventSchema.safeParse(
      JSON.parse(message, reviveDates),
    );
    if (!parsed.success) return;
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(parsed.data);
      return;
    }
    buffer.push(parsed.data);
    if (buffer.length > maxBuffered) void close();
  });
  await subscriber.subscribe(channel(conversationId));

  return {
    next: () => {
      const queued = buffer.shift();
      if (queued) return Promise.resolve(queued);
      if (closed) return Promise.resolve(null);
      return new Promise((resolve) => {
        waiting = resolve;
      });
    },
    close,
  };
}

/**
 * A subscription's events, with `'heartbeat'` whenever none arrived for
 * `heartbeatMs`, until the subscription closes. The subscription hands each
 * event to the one `next()` call waiting for it, so when the heartbeat wins
 * a round that call is kept for the next round instead of asking again: a
 * second call would take its place, and an event delivered to the first one
 * would be lost for good (a resume never resends it, the cursor has moved
 * past it). Nothing is lost while the consumer is busy between rounds.
 */
export async function* liveEvents(
  subscription: AssistantEventSubscription,
  heartbeatMs: number,
): AsyncGenerator<AssistantStreamEvent | 'heartbeat'> {
  let pending: Promise<AssistantStreamEvent | null> | null = null;
  while (true) {
    pending ??= subscription.next();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const event = await Promise.race([
      pending,
      new Promise<'heartbeat'>((resolve) => {
        timer = setTimeout(() => resolve('heartbeat'), heartbeatMs);
      }),
    ]);
    clearTimeout(timer);
    if (event === 'heartbeat') {
      yield event;
      continue;
    }
    pending = null;
    if (!event) return;
    yield event;
  }
}

const stopKey = (runId: string) => `assistant:run:${runId}:stop`;

/** How long a stop request stays visible to a running model step. */
const STOP_SIGNAL_TTL_SECONDS = 60 * 60;

/**
 * Stop requests are recorded in Postgres (`stopRequestedAt`); this Redis key
 * only lets an in-flight model stream notice quickly without polling the
 * database.
 */
export async function signalAssistantRunStop(runId: string): Promise<void> {
  const client = await connectedRedis();
  await client.set(stopKey(runId), '1', 'EX', STOP_SIGNAL_TTL_SECONDS);
}

export async function isAssistantRunStopSignalled(runId: string): Promise<boolean> {
  const client = await connectedRedis();
  return (await client.exists(stopKey(runId))) === 1;
}

const streamingTextKey = (itemId: string) => `assistant:item:${itemId}:text`;

/** How long in-progress text is kept for reconnecting viewers. */
const STREAMING_TEXT_TTL_SECONDS = 10 * 60;

/**
 * Keeps a streaming message's text so far. Postgres holds a message only
 * once it completes; a viewer who connects mid-stream gets this instead.
 */
export async function rememberStreamingText(itemId: string, text: string): Promise<void> {
  const client = await connectedRedis();
  await client.set(streamingTextKey(itemId), text, 'EX', STREAMING_TEXT_TTL_SECONDS);
}

export async function streamingTexts(itemIds: readonly string[]): Promise<Map<string, string>> {
  if (itemIds.length === 0) return new Map();
  const client = await connectedRedis();
  const values = await client.mget(...itemIds.map(streamingTextKey));
  return new Map(itemIds.flatMap((id, index) => (values[index] ? [[id, values[index]!] as const] : [])));
}
