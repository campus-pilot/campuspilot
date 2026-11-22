import { describe, expect, it } from 'vitest';

import {
  EXAM_DIALOG_NAME_TAKEN_MESSAGE,
  EXAM_DIALOG_SLUG_TAKEN_MESSAGE,
  examDialogSchema,
} from './exam-dialog-model';

const draft = {
  first_term: { name: 'First Term' },
  annual: { name: 'Annual Examination' },
};

function issues(
  values: { name: string; slug: string },
  options: Parameters<typeof examDialogSchema>[0],
) {
  const result = examDialogSchema(options).safeParse(values);
  return result.success
    ? {}
    : Object.fromEntries(
        result.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
      );
}

describe('session settings exam dialog rules', () => {
  it('refuses adding an exam whose name another exam has, by the shared name key', () => {
    for (const name of [
      'First Term',
      ' first term ',
      'FIRST TERM',
      // Inner whitespace runs, invisible format characters and compatibility forms.
      'First   Term',
      'First \u200bTerm',
      'Fir\u200bst Te\u2060rm',
      '\uff26irst \uff34erm',
    ])
      expect(issues({ name, slug: 'term_1' }, { examConfig: draft })).toEqual({
        name: EXAM_DIALOG_NAME_TAKEN_MESSAGE,
      });
    expect(issues({ name: 'Second Term', slug: 'second_term' }, { examConfig: draft })).toEqual({});
  });

  it('refuses a slug another exam has, beside the slug field', () => {
    expect(issues({ name: 'Annual', slug: 'annual' }, { examConfig: draft })).toEqual({
      slug: EXAM_DIALOG_SLUG_TAKEN_MESSAGE,
    });
  });

  it('allows keeping an exam’s own name or changing only its case', () => {
    for (const name of ['First Term', 'FIRST term '])
      expect(
        issues({ name, slug: 'first_term' }, { examConfig: draft, editingSlug: 'first_term' }),
      ).toEqual({});
  });

  it('refuses renaming an exam onto another exam’s name', () => {
    expect(
      issues(
        { name: 'annual examination', slug: 'first_term' },
        { examConfig: draft, editingSlug: 'first_term' },
      ),
    ).toEqual({ name: EXAM_DIALOG_NAME_TAKEN_MESSAGE });
  });

  it('keeps an exam stored with a duplicate name editable while its name and slug stay', () => {
    const duplicates = { a: { name: 'Final' }, b: { name: 'final' } };
    expect(issues({ name: 'Final', slug: 'a' }, { examConfig: duplicates, editingSlug: 'a' })).toEqual({});
    // A changed slug makes it a new exam for the server, which refuses the clash.
    expect(issues({ name: 'Final', slug: 'c' }, { examConfig: duplicates, editingSlug: 'a' })).toEqual({
      name: EXAM_DIALOG_NAME_TAKEN_MESSAGE,
    });
  });
});

describe('session settings exam dialog limits', () => {
  it('refuses a name longer than the createExam limit and one made only of invisible characters', () => {
    expect(issues({ name: 'a'.repeat(200), slug: 'long' }, { examConfig: {} })).toEqual({});
    expect(issues({ name: 'a'.repeat(201), slug: 'long' }, { examConfig: {} })).toEqual({
      name: 'Exam name must be 200 characters or fewer',
    });
    expect(issues({ name: '\u200b\u200d', slug: 'blank' }, { examConfig: {} })).toEqual({
      name: 'Exam name must contain visible characters',
    });
    expect(issues({ name: '   ', slug: 'blank' }, { examConfig: {} })).toEqual({
      name: 'Exam name is required',
    });
  });

  it('refuses the reserved slugs a plain object already answers for', () => {
    for (const slug of ['__proto__', 'constructor', 'prototype'])
      expect(issues({ name: 'Reserved', slug }, { examConfig: {} })).toEqual({
        slug: 'This slug is reserved. Choose another slug.',
      });
  });
});
