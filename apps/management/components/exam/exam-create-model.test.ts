import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FormApi } from '@tanstack/react-form';
import {
  EXAM_SLUG_TAKEN_REASON,
  isExamSlugTakenError,
} from '@campuspilot/api/routers/school/exam/exam-definition.contract';
import {
  createExamFormSchema,
  EXAM_SLUG_TAKEN_MESSAGE,
  emptyCreateExamForm,
  followNameSlug,
  startCreateExamAttempt,
  toCreateExamInput,
} from './exam-create-model';

const scope = { schoolId: 'school-1', sessionId: 'session-1' };

function slugIssues(values: Partial<typeof emptyCreateExamForm>) {
  const result = createExamFormSchema.safeParse({
    ...emptyCreateExamForm,
    ...values,
  });
  return result.success
    ? []
    : result.error.issues
        .filter((issue) => issue.path[0] === 'slug')
        .map((issue) => issue.message);
}

test('the slug follows the name with the session settings rule', () => {
  assert.equal(
    followNameSlug({ previousName: '', nextName: 'Unit Test 1', slug: '' }),
    'unit_test_1',
  );
  assert.equal(
    followNameSlug({
      previousName: 'Unit Test',
      nextName: '  Mid-Term  (Term 2) ',
      slug: 'unit_test',
    }),
    'mid_term_term_2',
  );
  // A name with nothing the rule keeps leaves an empty slug for the user to fill in.
  assert.equal(
    followNameSlug({ previousName: '', nextName: 'परीक्षा', slug: '' }),
    '',
  );
});

test('a slug the user typed is kept when the name changes', () => {
  assert.equal(
    followNameSlug({
      previousName: 'Unit Test',
      nextName: 'Unit Test 1',
      slug: 'ut1',
    }),
    'ut1',
  );
});

test('the form accepts a name and a slug in the settings format', () => {
  assert.equal(
    createExamFormSchema.safeParse({
      ...emptyCreateExamForm,
      name: 'Unit Test 1',
      slug: 'unit_test_1',
    }).success,
    true,
  );
});

test('the form refuses an empty name and a slug outside the settings format', () => {
  const result = createExamFormSchema.safeParse({
    ...emptyCreateExamForm,
    name: '   ',
    slug: 'Unit-Test',
  });
  assert.equal(result.success, false);
  assert.deepEqual(
    result.error?.issues.map((issue) => issue.path[0]).sort(),
    ['name', 'slug'],
  );
  assert.deepEqual(slugIssues({ name: 'Exam', slug: '' }), [
    'Exam slug is required',
  ]);
  assert.equal(slugIssues({ name: 'Exam', slug: 'a'.repeat(101) }).length, 1);
});

test('a slug the server refused as a duplicate is shown beside the slug field until it changes', () => {
  assert.deepEqual(
    slugIssues({ name: 'Final', slug: 'final', takenSlugs: ['final'] }),
    [EXAM_SLUG_TAKEN_MESSAGE],
  );
  assert.deepEqual(
    slugIssues({ name: 'Final', slug: 'final_2', takenSlugs: ['final'] }),
    [],
  );
});

test('the request trims the values and leaves the order to the server', () => {
  const input = toCreateExamInput(scope, {
    name: '  Unit Test 1 ',
    slug: ' unit_test_1 ',
    takenSlugs: [],
  });
  assert.deepEqual(input, {
    schoolId: 'school-1',
    sessionId: 'session-1',
    examSlug: 'unit_test_1',
    name: 'Unit Test 1',
  });
  assert.equal('order' in input, false);
});

test('only the CONFLICT with the taken-slug reason means the slug is taken', () => {
  assert.equal(
    isExamSlugTakenError({ code: 'CONFLICT', data: { reason: EXAM_SLUG_TAKEN_REASON } }),
    true,
  );
  // A database conflict (unique violation, deadlock, serialization failure) is not a taken slug.
  assert.equal(isExamSlugTakenError({ code: 'CONFLICT' }), false);
  assert.equal(isExamSlugTakenError({ code: 'CONFLICT', data: { reason: 'OTHER' } }), false);
  assert.equal(
    isExamSlugTakenError({ code: 'BAD_REQUEST', data: { reason: EXAM_SLUG_TAKEN_REASON } }),
    false,
  );
  assert.equal(isExamSlugTakenError(new Error('offline')), false);
});

/**
 * Drives a real form built like the dialog's: the same schema, and an
 * onSubmit that answers with a form-level refusal the way the dialog does.
 */
function refusingForm() {
  let attempts = 0;
  const form = new FormApi({
    defaultValues: {
      ...emptyCreateExamForm,
      name: 'Unit Test 1',
      slug: 'unit_test_1',
    },
    validators: { onChange: createExamFormSchema },
    onSubmit: () => {
      attempts += 1;
      form.setErrorMap({
        onSubmit: { form: 'This school is suspended.', fields: {} },
      });
    },
  });
  form.mount();
  return { form, attempts: () => attempts };
}

test('a form-level refusal never stops the next attempt from reaching the server', async () => {
  const { form, attempts } = refusingForm();

  await startCreateExamAttempt(form);
  assert.equal(attempts(), 1);
  assert.deepEqual(form.state.errors, ['This school is suspended.']);

  await startCreateExamAttempt(form);
  await startCreateExamAttempt(form);
  assert.equal(attempts(), 3);
});
