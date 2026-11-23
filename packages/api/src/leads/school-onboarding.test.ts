import { describe, expect, it } from 'vitest';

import { MAX_VOICE_NOTE_SECONDS, schoolOnboardingResponseSchema, type SchoolOnboardingResponseInput } from './school-onboarding';
import { sniffLogo, sniffVoiceNote } from './school-onboarding.upload';

const base: SchoolOnboardingResponseInput = {
  schoolName: 'Green Valley School',
  phone: '98765 43210',
  email: '',
  address: '12 Station Road, Jaipur',
  classes: [{ name: 'Class 1', sections: ['A', 'B'], subjects: ['English', 'Mathematics'] }],
  notes: '  ',
  voiceNoteSeconds: null,
};

describe('school onboarding answers', () => {
  it('normalises the phone, blanks and names', () => {
    const parsed = schoolOnboardingResponseSchema.parse({
      ...base,
      classes: [{ name: '  Class   1 ', sections: [' A '], subjects: ['Computer  Science'] }],
    });
    expect(parsed).toMatchObject({ phone: '+919876543210', email: null, notes: null });
    expect(parsed.classes[0]).toEqual({ name: 'Class 1', sections: ['A'], subjects: ['Computer Science'] });
  });

  it('requires a class, and a section and subject for each class', () => {
    expect(schoolOnboardingResponseSchema.safeParse({ ...base, classes: [] }).success).toBe(false);
    expect(schoolOnboardingResponseSchema.safeParse({ ...base, classes: [{ name: 'UKG', sections: [], subjects: ['English'] }] }).success).toBe(false);
    expect(schoolOnboardingResponseSchema.safeParse({ ...base, classes: [{ name: 'UKG', sections: ['A'], subjects: [] }] }).success).toBe(false);
  });

  it('refuses the same class, section or subject twice, whatever the case', () => {
    const twice = (classes: SchoolOnboardingResponseInput['classes']) => schoolOnboardingResponseSchema.safeParse({ ...base, classes }).success;
    expect(twice([...base.classes, { name: 'class 1', sections: ['A'], subjects: ['English'] }])).toBe(false);
    expect(twice([{ name: 'LKG', sections: ['A', 'a'], subjects: ['English'] }])).toBe(false);
    expect(twice([{ name: 'LKG', sections: ['A'], subjects: ['Hindi', 'HINDI'] }])).toBe(false);
  });

  it('requires a phone and address, and a valid email when one is given', () => {
    expect(schoolOnboardingResponseSchema.safeParse({ ...base, phone: '12' }).success).toBe(false);
    expect(schoolOnboardingResponseSchema.safeParse({ ...base, address: '' }).success).toBe(false);
    expect(schoolOnboardingResponseSchema.safeParse({ ...base, email: 'nope' }).success).toBe(false);
    expect(schoolOnboardingResponseSchema.parse({ ...base, email: 'office@gmail.com' }).email).toBe('office@gmail.com');
  });

  it('holds a voice note to ten minutes', () => {
    expect(schoolOnboardingResponseSchema.safeParse({ ...base, voiceNoteSeconds: MAX_VOICE_NOTE_SECONDS }).success).toBe(true);
    expect(schoolOnboardingResponseSchema.safeParse({ ...base, voiceNoteSeconds: MAX_VOICE_NOTE_SECONDS + 1 }).success).toBe(false);
  });
});

const bytes = (...values: (number | string)[]) =>
  Uint8Array.from(values.flatMap((value) => (typeof value === 'string' ? [...value].map((character) => character.charCodeAt(0)) : [value])));

describe('school onboarding file sniffing', () => {
  it('recognises logos by their bytes only', () => {
    expect(sniffLogo(bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a))?.contentType).toBe('image/png');
    expect(sniffLogo(bytes(0xff, 0xd8, 0xff))?.contentType).toBe('image/jpeg');
    expect(sniffLogo(bytes('<svg>'))).toBeNull();
  });

  it('recognises WebM, Ogg and MP4 recordings, and refuses HEIC', () => {
    expect(sniffVoiceNote(bytes(0x1a, 0x45, 0xdf, 0xa3, 0x01))?.contentType).toBe('audio/webm');
    expect(sniffVoiceNote(bytes('OggS', 0))?.contentType).toBe('audio/ogg');
    expect(sniffVoiceNote(bytes(0, 0, 0, 0x18, 'ftypiso5'))).toMatchObject({ contentType: 'audio/mp4', extension: 'm4a' });
    expect(sniffVoiceNote(bytes(0, 0, 0, 0x18, 'ftypheic'))).toBeNull();
    expect(sniffVoiceNote(bytes(0xff, 0xd8, 0xff))).toBeNull();
  });
});
