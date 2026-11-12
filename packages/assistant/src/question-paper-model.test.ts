import { describe, expect, it } from 'vitest';

import { questionPaperModelOf } from './question-paper-model';
import { createFakeProvider, fakeTextResult, FakeModelError, FAKE_PRICES, FAKE_REPORTED_MODEL, FAKE_USAGE } from './runtime/providers/fake';
import { withBilledUsage } from './runtime/providers/types';

describe('questionPaperModelOf', () => {
  const settings = { id: 'anthropic' as const, apiKey: 'key', model: 'fake-configured-model', prices: FAKE_PRICES };

  it('exposes the provider, its model, prices and readable image types', () => {
    const model = questionPaperModelOf(createFakeProvider({ imageMimeTypes: ['image/jpeg'] }), settings);
    expect(model).toMatchObject({ provider: 'anthropic', model: 'fake-configured-model', prices: FAKE_PRICES, imageMimeTypes: ['image/jpeg'] });
  });

  it('forwards one request and renames the answered model', async () => {
    const fake = createFakeProvider();
    fake.enqueueText(fakeTextResult({ text: '<p>ok</p>', truncated: true }));
    const model = questionPaperModelOf(fake, settings);
    const result = await model.generate({ system: 's', parts: [{ type: 'text', text: 'hi' }], maxOutputTokens: 5 });
    expect(result).toEqual({ text: '<p>ok</p>', usage: FAKE_USAGE, answeredModel: FAKE_REPORTED_MODEL, refusal: false, truncated: true });
    expect(fake.textCalls[0]!.input).toMatchObject({ system: 's', maxOutputTokens: 5 });
  });

  it('classifies failures and reports billed usage through the provider', () => {
    const model = questionPaperModelOf(createFakeProvider(), settings);
    expect(model.failureKind(new FakeModelError('rejected', 'x'))).toBe('rejected');
    const error = withBilledUsage(new Error('x'), { usage: FAKE_USAGE, complete: false, model: 'm' });
    expect(model.billedUsageOf(error)).toEqual({ usage: FAKE_USAGE, complete: false, model: 'm' });
  });
});
