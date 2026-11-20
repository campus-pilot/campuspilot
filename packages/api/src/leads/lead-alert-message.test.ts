import { describe, expect, it } from 'vitest';

import { buildLeadAlertMessage } from './lead-alert-message';

function params(message: ReturnType<typeof buildLeadAlertMessage>) {
  const body = message.components.find((component) => component.type === 'body');
  return Object.fromEntries((body?.parameters ?? []).map((parameter) => [(parameter as { parameter_name: string }).parameter_name, (parameter as { text: string }).text]));
}

describe('lead alert message', () => {
  it('fills every template parameter from the answers', () => {
    const message = buildLeadAlertMessage(
      {
        id: 'lead_abc',
        form: 'book_demo',
        response: {
          name: 'Asha Verma',
          phone: '+919876543210',
          whatsappNumber: '+919876543210',
          email: 'asha@school.in',
          schoolName: 'Green Valley School',
          approxStudents: 450,
          approxStaff: 30,
          preferredContact: 'whatsapp',
        },
      },
      '+917023908472',
    );
    expect(message).toMatchObject({ to: '+917023908472', name: 'demo_lead_alert', languageCode: 'en' });
    expect(params(message)).toEqual({
      name: 'Asha Verma',
      phone: '+91 98765 43210',
      whatsapp: '+91 98765 43210',
      email: 'asha@school.in',
      school: 'Green Valley School',
      size: 'about 450 students, about 30 staff',
      contact: 'WhatsApp',
      reference: 'lead_abc',
    });
  });

  it('reads missing or retyped answers as not given instead of failing', () => {
    const values = params(buildLeadAlertMessage({ id: 'lead_x', form: 'book_demo', response: { name: 'A', approxStudents: '400' } }, '+917023908472'));
    expect(values).toMatchObject({ phone: 'not given', email: 'not given', size: 'not given', contact: 'not given' });
  });
});
