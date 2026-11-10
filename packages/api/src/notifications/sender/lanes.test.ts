import { describe, expect, it } from 'vitest';

import { parseSenderKey, senderKey, senderLaneFor, senderPokeIdempotencyKey, uniqueSenderTargets, WEB_PUSH_SENDER_LANES } from './lanes';

describe('sender lanes (D-39)', () => {
  it('sends WhatsApp from one lane and shards web push stably by school', () => {
    expect(senderLaneFor('whatsapp', 'sch_a')).toBe(0);
    const lanes = new Set(Array.from({ length: 200 }, (_, index) => senderLaneFor('web_push', `sch_${index}`)));
    expect([...lanes].sort()).toEqual([...Array(WEB_PUSH_SENDER_LANES).keys()]);
    expect(senderLaneFor('web_push', 'sch_fixed')).toBe(senderLaneFor('web_push', 'sch_fixed'));
  });

  it('round-trips sender keys and refuses anything else', () => {
    expect(senderKey({ channel: 'whatsapp', lane: 0 })).toBe('whatsapp');
    expect(senderKey({ channel: 'web_push', lane: 3 })).toBe('web_push:3');
    expect(parseSenderKey('web_push:3')).toEqual({ channel: 'web_push', lane: 3 });
    expect(parseSenderKey('whatsapp')).toEqual({ channel: 'whatsapp', lane: 0 });
    for (const bad of ['whatsapp:1', 'sms:0', 'web_push', 'web_push:x', '']) expect(parseSenderKey(bad), bad).toBeNull();
  });

  it('folds pokes of one lane within a window into one idempotency key', () => {
    const target = { channel: 'whatsapp' as const, lane: 0 };
    expect(senderPokeIdempotencyKey(target, 10_000)).toBe(senderPokeIdempotencyKey(target, 19_999));
    expect(senderPokeIdempotencyKey(target, 10_000)).not.toBe(senderPokeIdempotencyKey(target, 20_000));
    expect(uniqueSenderTargets([target, target, { channel: 'web_push', lane: 1 }])).toHaveLength(2);
  });
});
