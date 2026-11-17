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
  it('refuses adding an exam whose name another exam has, trimmed and ignoring case', () => {
    for (const name of ['First Term', ' first term ', 'FIRST TERM'])
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
