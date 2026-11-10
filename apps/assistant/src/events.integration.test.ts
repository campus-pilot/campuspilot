import { afterEach, describe, expect, it } from 'vitest';

import { liveEvents, publishAssistantEvent, subscribeAssistantEvents, type AssistantEventSubscription } from './events';
import { generateId } from './ids';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const open: AssistantEventSubscription[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((subscription) => subscription.close()));
});

describe('liveEvents', () => {
  it('keeps an event that arrives while the consumer is busy after a heartbeat', async () => {
    const conversationId = generateId('conversation');
    const subscription = await subscribeAssistantEvents(conversationId);
    open.push(subscription);
    const events = liveEvents(subscription, 30);

    // Nothing was published, so the first round is a heartbeat.
    expect((await events.next()).value).toBe('heartbeat');

    // The consumer is busy (sending the heartbeat, checking access) while
    // the event arrives: nobody is asking for the next value right now.
    await publishAssistantEvent(conversationId, { type: 'synchronized' });
    await sleep(100);

    const seen: unknown[] = [];
    for (let round = 0; round < 5; round += 1) {
      const { value } = await events.next();
      seen.push(value);
      if (value !== 'heartbeat') break;
    }
    expect(seen.at(-1)).toEqual({ type: 'synchronized' });
  });

  it('ends when the subscription closes', async () => {
    const subscription = await subscribeAssistantEvents(generateId('conversation'));
    const events = liveEvents(subscription, 1_000);
    const next = events.next();
    await subscription.close();
    expect(await next).toEqual({ value: undefined, done: true });
  });
});
