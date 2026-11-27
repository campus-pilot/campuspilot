import { describe, expect, it } from 'vitest';

import {
  examModesOf,
  followingSlug,
  newSubjectFormValue,
  slugifySubject,
  subjectFormSchema,
  subjectFormValueOf,
} from './subject-form-model';

describe('subject form model', () => {
  it('generates the slug from the name until the person edits it', () => {
    expect(slugifySubject(' General Knowledge! ')).toBe('general-knowledge');
    expect(followingSlug('', 'Art', '')).toBe('art');
    expect(followingSlug('Art', 'Art and craft', 'art')).toBe('art-and-craft');
    expect(followingSlug('Art', 'Art and craft', 'drawing')).toBe('drawing');
  });

  it('round-trips a stored subject and validates mode totals and slugs', () => {
    const value = subjectFormValueOf('maths', { name: 'Maths', examModes: { written: { name: 'Written', percentage: 100 } } });
    expect(examModesOf(value)).toEqual({ written: { name: 'Written', percentage: 100 } });
    expect(subjectFormSchema.safeParse(value).success).toBe(true);
    expect(subjectFormSchema.safeParse({ ...newSubjectFormValue(), name: 'Art', slug: 'art' }).success).toBe(true);
    expect(subjectFormSchema.safeParse({ ...value, examModes: [{ name: 'Written', slug: 'written', percentage: 90 }] }).success).toBe(false);
    expect(subjectFormSchema.safeParse({ ...value, slug: 'Not a slug' }).success).toBe(false);
  });
});
