import { describe, expect, it } from 'vitest';

import { demoRequestResponseSchema } from './demo-request';

const base = {
  name: 'Asha Verma',
  phone: '98765 43210',
  hasWhatsAppOnPhone: true,
  whatsappNumber: null,
  email: '',
  preferredContact: 'whatsapp' as const,
  schoolName: '  ',
  approxStudents: 450,
  approxStaff: 30,
};

describe('demo request answers', () => {
  it('stores the phone as the WhatsApp number when they are the same', () => {
    const parsed = demoRequestResponseSchema.parse({ ...base, whatsappNumber: '+919000000000' });
    expect(parsed).toMatchObject({ phone: '+919876543210', whatsappNumber: '+919876543210', email: null, schoolName: null });
  });

  it('keeps a separate WhatsApp number', () => {
    const parsed = demoRequestResponseSchema.parse({ ...base, hasWhatsAppOnPhone: false, whatsappNumber: '+91 90000 00001' });
    expect(parsed.whatsappNumber).toBe('+919000000001');
  });

  it('asks for a WhatsApp number when WhatsApp is the preferred contact', () => {
    const result = demoRequestResponseSchema.safeParse({ ...base, hasWhatsAppOnPhone: false });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['whatsappNumber']);
  });

  it('accepts a phone call preference without WhatsApp', () => {
    const parsed = demoRequestResponseSchema.parse({ ...base, hasWhatsAppOnPhone: false, preferredContact: 'phone_call' });
    expect(parsed.whatsappNumber).toBeNull();
  });

  it('requires a name, a valid phone and rough counts', () => {
    expect(demoRequestResponseSchema.safeParse({ ...base, name: ' ' }).success).toBe(false);
    expect(demoRequestResponseSchema.safeParse({ ...base, phone: '12' }).success).toBe(false);
    expect(demoRequestResponseSchema.safeParse({ ...base, approxStudents: 0 }).success).toBe(false);
    expect(demoRequestResponseSchema.safeParse({ ...base, email: 'nope' }).success).toBe(false);
  });
});
