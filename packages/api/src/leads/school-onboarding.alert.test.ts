import { describe, expect, it } from 'vitest';

import { buildOnboardingAlertMessage } from './school-onboarding.alert';

describe('school onboarding alert message', () => {
  it('names the school, contact, classes and reference', () => {
    const message = buildOnboardingAlertMessage(
      {
        id: 'srreq_abc',
        response: { schoolName: 'Green Valley', phone: '+919876543210', email: null, classes: [{ name: 'LKG' }, { name: 'Class 1' }] },
      },
      '+911234567890',
    );
    expect(message).toMatchObject({ to: '+911234567890', name: 'school_onboarding_alert', languageCode: 'en' });
    const params = Object.fromEntries(message.components![0]!.parameters.flatMap((parameter) => (parameter.type === 'text' ? [[parameter.parameter_name, parameter.text]] : [])));
    expect(params).toEqual({ school: 'Green Valley', phone: '+91 98765 43210', email: 'not given', classes: '2: LKG, Class 1', reference: 'srreq_abc' });
  });
});
