import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { z } from 'zod';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FieldApi, FormApi } from '@tanstack/react-form';
import { QueryClient } from '@tanstack/react-query';
import type {
  ExamContextDto,
  ExamPlanDto,
  ExamResultDto,
} from '@campuspilot/api/routers/school/exam/exam.dto';
import { ResultSummary } from '@campuspilot/components/exam/result-summary';
import {
  resultDefaults,
  resultFormSchema,
  resultPayload,
  numericText,
  toPlanScope,
  toResultScope,
} from './exam-model';
import {
  planFormSchema,
  timetableFormSchema,
  timetableSchema,
} from './exam-validation';
import {
  confirmNavigation,
  registerNavigationGuard,
} from '@/lib/navigation-guard';

const context: ExamContextDto = {
  exam: { slug: 'midterm', name: 'Mid-Term', order: 1 },
  classes: ['class-a', 'class-b'].map((id) => ({
    id,
    label: id,
    subjects: {
      maths: {
        name: 'Mathematics',
        examModes: {
          written: { name: 'Written', percentage: 80 },
          practical: { name: 'Practical', percentage: 20 },
          oral: { name: 'Oral', percentage: 0 },
        },
      },
    },
  })),
  coScholasticAreas: { art: { name: 'Art' } },
  attendanceTracking: { enabled: true },
};
const plan: ExamPlanDto = {
  id: 'plan-a',
  schoolId: 'school',
  sessionId: 'session',
  examSlug: 'midterm',
  classId: 'class-a',
  subjectSlug: 'maths',
  totalMarks: 100,
  modeConfig: {
    written: { percentage: 80, maxMarks: 80 },
    practical: { percentage: 20, maxMarks: 20 },
  },
  totalWorkingDays: 200,
  status: 'active',
  createdAt: null,
  updatedAt: null,
};
const result: ExamResultDto = {
  id: 'result',
  schoolId: 'school',
  sessionId: 'session',
  examPlanId: plan.id,
  studentId: 'enrollment',
  marks: { written: 65, practical: 18 },
  coScholastics: { art: 'A' },
  daysAttended: 180,
  approved: false,
  createdAt: null,
  updatedAt: null,
};
const validPlan = {
  classId: 'class-a',
  subjectSlug: 'maths',
  totalMarks: '100',
  totalWorkingDays: '800',
  modes: [
    { slug: 'written', percentage: '80', enabled: true },
    { slug: 'practical', percentage: '20', enabled: true },
  ],
  duplicate: false,
};
const cell = { subjectSlug: 'maths', modeSlug: 'written' };
const slot = (
  id: string,
  startTime: string,
  endTime: string,
  classId = 'class-a',
) => ({
  id,
  date: '2026-10-20',
  startTime,
  endTime,
  cells: { [classId]: cell },
});

test('empty marks remain empty and cannot be submitted as zero', async () => {
  const values = resultDefaults(plan, context, null);
  assert.equal(values.marks[0]?.value, '');
  assert.equal(
    resultFormSchema(plan, context).safeParse(values).success,
    false,
  );
  let calls = 0;
  const form = new FormApi({
    defaultValues: values,
    validators: { onSubmit: resultFormSchema(plan, context) },
    onSubmit: () => {
      calls++;
    },
  });
  const unmount = form.mount();
  const scores = [
    new FieldApi({ form, name: 'marks[0].value' }),
    new FieldApi({ form, name: 'marks[1].value' }),
  ];
  const unmountFields = scores.map((field) => field.mount());
  await form.handleSubmit();
  assert.equal(calls, 0);
  scores.forEach((field) => field.handleChange('0'));
  await form.handleSubmit();
  assert.equal(calls, 1);
  unmountFields.forEach((unmountField) => unmountField());
  unmount();
});
test('zero scores and zero attendance are valid explicit values', () => {
  const values = resultDefaults(plan, context, null);
  values.marks.forEach((item) => {
    item.value = '0';
  });
  values.daysAttended = '0';
  const payload = resultPayload(resultFormSchema(plan, context).parse(values));
  assert.deepEqual(payload.marks, { written: 0, practical: 0 });
  assert.equal(payload.daysAttended, 0);
  assert.equal(payload.coScholastics, null);
});
test('marks-only changes preserve grades and attendance and send explicit approval intent', () => {
  const values = resultDefaults(plan, context, result);
  values.marks[0]!.value = '65.123456789';
  const payload = resultPayload(resultFormSchema(plan, context).parse(values));
  assert.equal(payload.marks.written, 65.123456789);
  assert.deepEqual(payload.coScholastics, { art: 'A' });
  assert.equal(payload.daysAttended, 180);
  assert.equal(payload.approved, false);
  values.approved = true;
  assert.equal(resultPayload(values).approved, true);
});
test('invalid numeric text, missing components, and scores over maxima are rejected', () => {
  for (const text of ['', ' ', '65abc', 'Infinity', 'NaN', '0x10'])
    assert.equal(numericText.safeParse(text).success, false, text);
  const values = resultDefaults(plan, context, result);
  values.marks[0]!.value = '80.01';
  assert.equal(
    resultFormSchema(plan, context).safeParse(values).success,
    false,
  );
  values.marks = [{ slug: 'written', value: '65' }];
  assert.equal(
    resultFormSchema(plan, context).safeParse(values).success,
    false,
  );
  values.marks = [
    { slug: 'written', value: '65' },
    { slug: 'unexpected', value: '18' },
  ];
  assert.equal(
    resultFormSchema(plan, context).safeParse(values).success,
    false,
  );
});
test('zero-maximum modes still require an explicit zero', () => {
  const withZero = {
    ...plan,
    modeConfig: { ...plan.modeConfig, oral: { percentage: 0, maxMarks: 0 } },
  };
  const values = resultDefaults(withZero, context, result);
  assert.equal(
    resultFormSchema(withZero, context).safeParse(values).success,
    false,
  );
  values.marks[2]!.value = '0';
  assert.equal(
    resultFormSchema(withZero, context).safeParse(values).success,
    true,
  );
});
test('historical grades and disabled attendance are retained until explicitly corrected', () => {
  const historical = {
    ...result,
    coScholastics: { removed: 'B' },
    daysAttended: 0,
  };
  const changed = { ...context, attendanceTracking: { enabled: false } };
  const values = resultDefaults(plan, changed, historical);
  assert.deepEqual(
    values.grades.find((item) => item.slug === 'removed'),
    { slug: 'removed', value: 'B' },
  );
  assert.equal(values.daysAttended, '0');
  assert.equal(
    resultFormSchema(plan, changed).safeParse(values).success,
    false,
  );
  values.grades.forEach((item) => {
    item.value = '';
  });
  values.daysAttended = '';
  assert.equal(resultFormSchema(plan, changed).safeParse(values).success, true);
});
test('attendance is nullable and bounded by explicit working days', () => {
  const values = resultDefaults(plan, context, result);
  values.daysAttended = '201';
  assert.equal(
    resultFormSchema(plan, context).safeParse(values).success,
    false,
  );
  values.daysAttended = '0';
  assert.equal(
    resultFormSchema({ ...plan, totalWorkingDays: null }, context).safeParse(
      values,
    ).success,
    false,
  );
  values.daysAttended = '';
  assert.equal(
    resultFormSchema({ ...plan, totalWorkingDays: null }, context).safeParse(
      values,
    ).success,
    true,
  );
});
test('plan maxima must be integer-derived without rounding', () => {
  assert.equal(planFormSchema(context).safeParse(validPlan).success, true);
  assert.equal(
    planFormSchema(context).safeParse({ ...validPlan, totalMarks: '101' })
      .success,
    false,
  );
  assert.equal(
    planFormSchema(context).safeParse({
      ...validPlan,
      totalMarks: '2147483648',
    }).success,
    false,
  );
});
test('configured mode subsets and zero percent are allowed; invented or duplicate modes are rejected', () => {
  const modes = [
    { slug: 'written', percentage: '100', enabled: true },
    { slug: 'practical', percentage: '', enabled: false },
    { slug: 'oral', percentage: '0', enabled: true },
  ];
  assert.equal(
    planFormSchema(context).safeParse({ ...validPlan, modes }).success,
    true,
  );
  assert.equal(
    planFormSchema(context).safeParse({
      ...validPlan,
      modes: [{ slug: 'invented', percentage: '100', enabled: true }],
    }).success,
    false,
  );
  assert.equal(
    planFormSchema(context).safeParse({
      ...validPlan,
      modes: [
        { slug: 'written', percentage: '50', enabled: true },
        { slug: 'written', percentage: '50', enabled: true },
      ],
    }).success,
    false,
  );
});
test('working days do not have an invented 366-day ceiling, and disabled tracking requires null', () => {
  assert.equal(planFormSchema(context).safeParse(validPlan).success, true);
  const changed = { ...context, attendanceTracking: { enabled: false } };
  assert.equal(planFormSchema(changed).safeParse(validPlan).success, false);
  assert.equal(
    planFormSchema(changed).safeParse({ ...validPlan, totalWorkingDays: '' })
      .success,
    true,
  );
});
test('shared-grid validation detects hidden-class overlaps and allows adjacent slots', () => {
  const schema = timetableSchema(context);
  assert.equal(
    schema.safeParse({
      columns: ['class-a', 'class-b'],
      rows: [
        slot('a', '09:00', '10:00', 'class-b'),
        slot('b', '09:30', '11:00', 'class-b'),
      ],
    }).success,
    false,
  );
  assert.equal(
    schema.safeParse({
      columns: ['class-a'],
      rows: [slot('a', '09:00', '10:00'), slot('b', '10:00', '11:00')],
    }).success,
    true,
  );
  assert.equal(
    schema.safeParse({
      columns: ['class-a', 'class-b'],
      rows: [
        slot('a', '09:00', '10:00'),
        slot('b', '09:30', '11:00', 'class-b'),
      ],
    }).success,
    true,
  );
});
test('timetable rejects invalid dates, overnight slots, duplicate pairs, and undeclared columns', () => {
  const schema = timetableSchema(context);
  for (const row of [
    { ...slot('a', '09:00', '10:00'), date: '2026-02-30' },
    slot('a', '23:00', '01:00'),
    { ...slot('a', '09:00', '10:00'), cells: { 'class-a': [cell, cell] } },
    slot('a', '09:00', '10:00', 'class-b'),
  ])
    assert.equal(
      schema.safeParse({ columns: ['class-a'], rows: [row] }).success,
      false,
    );
  assert.equal(
    schema.safeParse({
      columns: ['class-a'],
      rows: [{ ...slot('a', '09:00', '10:00'), date: '2000-01-01' }],
    }).success,
    true,
  );
});
test('timetable accepts configured modes independent of the plan subset', () => {
  assert.equal(
    timetableSchema(context).safeParse({
      columns: ['class-a'],
      rows: [
        {
          ...slot('a', '09:00', '10:00'),
          cells: { 'class-a': { subjectSlug: 'maths', modeSlug: 'oral' } },
        },
      ],
    }).success,
    true,
  );
});
test('preview displays 83/100 and 83% without applying the weights again', () => {
  const html = renderToStaticMarkup(
    createElement(ResultSummary, { plan, result }),
  );
  assert.match(html, /83 \/ 100 · 83%/);
  assert.match(html, /Awaiting review/);
  const draft = renderToStaticMarkup(
    createElement(ResultSummary, {
      plan,
      result: { ...result, approved: true },
      unsaved: true,
    }),
  );
  assert.match(draft, /Unsaved preview/);
  assert.doesNotMatch(draft, /✓ Approved/);
});
test('partial scope invalidation reaches all pages/filters without invalidating another plan', async () => {
  const cache = new QueryClient();
  const scope = {
    schoolId: 'school',
    sessionId: 'session',
    examSlug: 'midterm',
    classId: 'class-a',
    examPlanId: 'plan-a',
    studentId: 'enrollment',
  };
  const prefix = [['school', 'listExamRoster'], { input: toPlanScope(scope) }];
  const first = [
    ['school', 'listExamRoster'],
    { input: { ...toPlanScope(scope), page: 1 } },
  ];
  const second = [
    ['school', 'listExamRoster'],
    { input: { ...toPlanScope(scope), page: 2 } },
  ];
  const other = [
    ['school', 'listExamRoster'],
    { input: { ...toPlanScope(scope), examPlanId: 'plan-b', page: 1 } },
  ];
  [first, second, other].forEach((key) => cache.setQueryData(key, []));
  await cache.invalidateQueries({ queryKey: prefix });
  assert.equal(cache.getQueryState(first)?.isInvalidated, true);
  assert.equal(cache.getQueryState(second)?.isInvalidated, true);
  assert.equal(cache.getQueryState(other)?.isInvalidated, false);
  assert.deepEqual(toResultScope(scope), {
    schoolId: 'school',
    sessionId: 'session',
    classId: 'class-a',
    examPlanId: 'plan-a',
    studentId: 'enrollment',
  });
  cache.clear();
});
test('programmatic scope changes stop when a mounted editor chooses to keep its edits', () => {
  const unregister = registerNavigationGuard(() => false);
  assert.equal(confirmNavigation(), false);
  unregister();
  assert.equal(confirmNavigation(), true);
});

test('a timetable validation failure can be corrected and submitted without stale nested errors', async () => {
  let calls = 0;
  const values: z.infer<ReturnType<typeof timetableFormSchema>> = {
    config: { columns: ['class-a'], rows: [slot('a', '10:00', '09:00')] },
    classId: 'class-a',
    addClassId: '',
    message: '',
  };
  const form = new FormApi({
    defaultValues: values,
    validators: { onSubmit: timetableFormSchema(context) },
    onSubmit: () => {
      calls++;
    },
  });
  const unmount = form.mount();
  const field = new FieldApi({ form, name: 'config' });
  const unmountField = field.mount();
  await form.handleSubmit();
  assert.equal(calls, 0);
  field.handleChange({ ...values.config, rows: [slot('a', '09:00', '10:00')] });
  await form.handleSubmit();
  assert.equal(calls, 1);
  unmountField();
  unmount();
});

test('background defaults do not reset a dirty student form or its additional assessments', () => {
  const initial = resultDefaults(plan, context, result);
  const form = new FormApi({
    defaultValues: initial,
    validators: { onSubmit: resultFormSchema(plan, context) },
  });
  const unmount = form.mount();
  const score = new FieldApi({ form, name: 'marks[0].value' });
  const unmountScore = score.mount();
  score.handleChange('66');
  form.update({
    defaultValues: resultDefaults(plan, context, {
      ...result,
      marks: { written: 50, practical: 10 },
      coScholastics: { art: 'B' },
    }),
  });
  assert.equal(form.state.values.marks[0]?.value, '66');
  assert.equal(form.state.values.grades[0]?.value, 'A');
  assert.equal(form.state.values.daysAttended, '180');
  unmountScore();
  unmount();
});
