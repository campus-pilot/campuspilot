import { describe, expect, it } from 'vitest';

import { backfillAdmissionPhone } from './admission-phone-e164';

describe('backfillAdmissionPhone', () => {
  it('stores parseable numbers in E.164 and uses them as the WhatsApp number', () => {
    for (const stored of ['9876543210', '98765 43210', '098765-43210', '919876543210', '+91 98765 43210']) {
      expect(backfillAdmissionPhone(stored)).toEqual({ kind: 'parsed', phoneNo: '+919876543210', whatsappNo: '+919876543210', whatsappSameAsPhone: true });
    }
    expect(backfillAdmissionPhone('+1 415 555 2671')).toMatchObject({ kind: 'parsed', phoneNo: '+14155552671' });
  });

  it('prefixes +91 onto values that do not parse and records no WhatsApp number', () => {
    expect(backfillAdmissionPhone(' 9876543210 / 9123456789 ')).toEqual({
      kind: 'unparseable',
      phoneNo: '+919876543210 / 9123456789',
      whatsappNo: null,
      whatsappSameAsPhone: false,
    });
    expect(backfillAdmissionPhone('12345')).toMatchObject({ kind: 'unparseable', phoneNo: '+9112345' });
    // Never prefixed twice.
    expect(backfillAdmissionPhone('+91 ask at office')).toMatchObject({ kind: 'unparseable', phoneNo: '+91 ask at office' });
  });

  it('keeps blank values unchanged instead of storing a bare +91', () => {
    expect(backfillAdmissionPhone('')).toEqual({ kind: 'blank', phoneNo: '', whatsappNo: null, whatsappSameAsPhone: false });
    expect(backfillAdmissionPhone('   ')).toEqual({ kind: 'blank', phoneNo: '   ', whatsappNo: null, whatsappSameAsPhone: false });
  });

  it('does not guess at a trunk 0 before the country code', () => {
    expect(backfillAdmissionPhone('0919876543210')).toMatchObject({ kind: 'unparseable', whatsappNo: null });
  });
});
