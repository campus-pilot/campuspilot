import {
  classConfigSchema,
  isSubjectOfferedInExam,
  readStoredClassConfig,
  subjectsOfferedInExam,
  type Subject,
} from '@campuspilot/db/schema/jsonb/class-config';
import { describe, expect, it } from 'vitest';

import { storedSubjects } from './class-subject.service';

const term = { sessionId: 'session-1', examSlug: 'term' };
const modes = { written: { name: 'Written', percentage: 100 } };
const school: Subject = { name: 'Maths', books: [], examModes: modes, attachment: { kind: 'school' } };
const examOnly: Subject = { name: 'GK', books: [], examModes: modes, attachment: { kind: 'exam', exams: [term] } };

describe('isSubjectOfferedInExam', () => {
  it('offers a classroom subject in every exam and an exam-only subject only in its exams', () => {
    expect(isSubjectOfferedInExam(school, term)).toBe(true);
    expect(isSubjectOfferedInExam(examOnly, term)).toBe(true);
    expect(isSubjectOfferedInExam(examOnly, { ...term, examSlug: 'term2' })).toBe(false);
    // The same slug in another session is another exam.
    expect(isSubjectOfferedInExam(examOnly, { ...term, sessionId: 'session-2' })).toBe(false);
    expect(Object.keys(subjectsOfferedInExam({ maths: school, gk: examOnly }, { ...term, examSlug: 'term2' }))).toEqual(['maths']);
  });

  it('is stored explicitly: a stored subject without attachment does not parse, and an exam-only subject names exactly one exam', () => {
    expect(classConfigSchema.safeParse({ subjects: { maths: { name: 'Maths', examModes: modes } } }).success).toBe(false);
    expect(
      classConfigSchema.safeParse({ subjects: { gk: { ...examOnly, attachment: { kind: 'exam', exams: [] } } } }).success,
    ).toBe(false);
    expect(classConfigSchema.safeParse({ subjects: { maths: school, gk: examOnly } }).success).toBe(true);
  });
});

describe('storedSubjects', () => {
  it('keeps where existing subjects are offered and makes new subjects classroom subjects', () => {
    const { subjects, added, removed } = storedSubjects(
      {
        gk: { name: 'General knowledge', books: [], examModes: modes },
        art: { name: 'Art', books: [], examModes: modes },
      },
      { gk: examOnly, maths: school },
    );
    expect(subjects.gk).toEqual({ ...examOnly, name: 'General knowledge' });
    expect(subjects.art?.attachment).toEqual({ kind: 'school' });
    expect(subjects.maths).toBeUndefined();
    expect(added).toEqual(['art']);
    expect(removed).toEqual(['maths']);
  });

  it('accepts an unchanged attachment and refuses a changed or exam-only new one', () => {
    expect(storedSubjects({ gk: examOnly }, { gk: examOnly }).added).toEqual([]);
    expect(() => storedSubjects({ gk: { ...examOnly, attachment: { kind: 'school' } } }, { gk: examOnly })).toThrowError(
      expect.objectContaining({ code: 'BAD_REQUEST' }),
    );
    expect(() => storedSubjects({ gk: examOnly }, {})).toThrowError(expect.objectContaining({ code: 'BAD_REQUEST' }));
  });
});

describe('readStoredClassConfig', () => {
  it('reads a stored subject without attachment as a classroom subject and keeps stored attachments', () => {
    const read = readStoredClassConfig({
      subjects: { maths: { name: 'Maths', books: [], examModes: modes }, gk: examOnly },
    });
    expect(read.subjects.maths?.attachment).toEqual({ kind: 'school' });
    expect(read.subjects.gk).toEqual(examOnly);
    // The normalised value is a valid stored configuration again.
    expect(classConfigSchema.safeParse(read).success).toBe(true);
  });

  it('never fails on older or empty data', () => {
    expect(readStoredClassConfig(null)).toEqual({ subjects: {} });
    expect(readStoredClassConfig({})).toEqual({ subjects: {} });
    expect(readStoredClassConfig({ subjects: { constructor: { name: 'C', books: [], examModes: {} } } }).subjects['constructor' as string]?.attachment).toEqual({ kind: 'school' });
  });
});
