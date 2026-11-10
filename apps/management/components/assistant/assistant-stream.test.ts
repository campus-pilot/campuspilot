import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ORPCError } from '@orpc/client';

import {
  conversationFailure,
  isClientError,
  reconnectingStream,
  refusalMessage,
  retryUnlessRefused,
} from './assistant-stream';

type Event = { type: 'data' | 'synchronized'; value?: number };

async function* connection(events: Event[]): AsyncGenerator<Event> {
  yield* events;
}

/** Runs the loop over scripted connections; aborts when the script runs out. */
function scripted(connections: Array<Event[] | Error>) {
  const controller = new AbortController();
  const delays: number[] = [];
  let subscribed = 0;
  let disconnects = 0;
  const stream = reconnectingStream<Event>({
    signal: controller.signal,
    subscribe: async () => {
      const next = connections[subscribed];
      subscribed += 1;
      if (next instanceof Error) throw next;
      if (!next) {
        controller.abort();
        return connection([]);
      }
      return connection(next);
    },
    delay: async (attempt) => {
      delays.push(attempt);
    },
    isSynchronized: (event) => event.type === 'synchronized',
    isFinal: isClientError,
    onDisconnect: () => {
      disconnects += 1;
    },
  });
  return { stream, controller, delays, subscribed: () => subscribed, disconnects: () => disconnects };
}

async function collect(stream: AsyncIterable<Event>): Promise<Event[]> {
  const events: Event[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

test('reconnects after a clean close and keeps delivering events', async () => {
  const run = scripted([[{ type: 'data', value: 1 }], [{ type: 'data', value: 2 }]]);
  const events = await collect(run.stream);
  assert.deepEqual(events.map((event) => event.value), [1, 2]);
  assert.equal(run.subscribed(), 3);
  assert.equal(run.disconnects(), 2);
});

test('reconnects after a network or server failure', async () => {
  const run = scripted([new TypeError('Failed to fetch'), new ORPCError('BAD_GATEWAY', { status: 502 }), [{ type: 'data', value: 1 }]]);
  const events = await collect(run.stream);
  assert.deepEqual(events.map((event) => event.value), [1]);
  assert.deepEqual(run.delays, [0, 1, 2]);
});

test('backoff grows while a connection never catches up and resets after synchronized', async () => {
  const run = scripted([
    [{ type: 'data' }],
    [{ type: 'data' }],
    [{ type: 'data' }, { type: 'synchronized' }],
    [{ type: 'data' }],
  ]);
  await collect(run.stream);
  assert.deepEqual(run.delays, [0, 1, 0, 1]);
});

test('stops on abort without reconnecting or reporting a drop', async () => {
  const run = scripted([[{ type: 'data', value: 1 }, { type: 'data', value: 2 }]]);
  const events: Event[] = [];
  for await (const event of run.stream) {
    events.push(event);
    run.controller.abort();
  }
  assert.deepEqual(events.map((event) => event.value), [1]);
  assert.equal(run.subscribed(), 1);
  assert.equal(run.disconnects(), 0);
  assert.deepEqual(run.delays, []);
});

test('an abort during the wait ends the stream', async () => {
  const controller = new AbortController();
  let subscribed = 0;
  const stream = reconnectingStream<Event>({
    signal: controller.signal,
    subscribe: async () => {
      subscribed += 1;
      return connection([]);
    },
    delay: async () => controller.abort(),
    isSynchronized: () => false,
    isFinal: isClientError,
    onDisconnect: () => undefined,
  });
  assert.deepEqual(await collect(stream), []);
  assert.equal(subscribed, 1);
});

test('throws on a 404 instead of reconnecting', async () => {
  const notFound = new ORPCError('NOT_FOUND', { status: 404 });
  const run = scripted([[{ type: 'data', value: 1 }], notFound, [{ type: 'data', value: 2 }]]);
  await assert.rejects(collect(run.stream), (error) => error === notFound);
  assert.equal(run.subscribed(), 2);
  assert.deepEqual(run.delays, [0]);
});

test('an error after an abort is not thrown', async () => {
  const controller = new AbortController();
  const stream = reconnectingStream<Event>({
    signal: controller.signal,
    subscribe: async () => {
      controller.abort();
      throw new ORPCError('NOT_FOUND', { status: 404 });
    },
    delay: async () => undefined,
    isSynchronized: () => false,
    isFinal: isClientError,
    onDisconnect: () => assert.fail('an aborted stream is not a drop'),
  });
  assert.deepEqual(await collect(stream), []);
});

test('refusals are final; network and server failures are retried', () => {
  for (const status of [401, 403, 404]) {
    assert.equal(isClientError(new ORPCError('REFUSED', { status })), true);
    assert.equal(retryUnlessRefused(0, new ORPCError('REFUSED', { status })), false);
  }
  assert.equal(isClientError(new ORPCError('INTERNAL_SERVER_ERROR', { status: 500 })), false);
  assert.equal(isClientError(new TypeError('Failed to fetch')), false);
  assert.equal(retryUnlessRefused(0, new TypeError('Failed to fetch')), true);
  assert.equal(retryUnlessRefused(3, new TypeError('Failed to fetch')), false);
});

test('only a lost session reads as signed out', () => {
  assert.equal(conversationFailure(new ORPCError('UNAUTHORIZED', { status: 401 })), 'signed_out');
  assert.equal(conversationFailure(new ORPCError('NOT_FOUND', { status: 404 })), 'unavailable');
  assert.equal(conversationFailure(new ORPCError('FORBIDDEN', { status: 403 })), 'unavailable');
});

test('only a refusal brings its own message; other failures get the caller\'s words', () => {
  assert.equal(refusalMessage(new ORPCError('FORBIDDEN', { status: 403, message: 'You cannot use the assistant here.' })), 'You cannot use the assistant here.');
  assert.equal(refusalMessage(new TypeError('Failed to fetch')), null);
  assert.equal(refusalMessage(new ORPCError('INTERNAL_SERVER_ERROR', { status: 500, message: 'Internal server error' })), null);
});
