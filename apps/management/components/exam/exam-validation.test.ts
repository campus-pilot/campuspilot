import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { z } from 'zod';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FieldApi, FormApi } from '@tanstack/react-form';
import { QueryClient } from '@tanstack/react-query';
import type { ExamContextDto } from '@campuspilot/api/routers/school/exam/exam.dto';
import {
  copyTimetableTiming,
  decodeTimetablePair,
  encodeTimetablePair,
  nextTimetableDate,
  parseTimetableDate,
  removeTimetableColumn,
} from '@campuspilot/components/exam/timetable-builder-model';
import { ExamButton } from '@campuspilot/components/exam/exam-controls';
import {
  canCreateExamReportCards,
  hasExamStarted,
  numericText,
  isExamSaveUncertain,
  toExamScope,
} from './exam-model';
import { timetableFormSchema, timetableSchema } from './exam-validation';
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

test('numeric text rejects blank, partial and nondecimal marks', () => {
  for (const text of ['', ' ', '65abc', 'Infinity', 'NaN', '0x10'])
    assert.equal(numericText.safeParse(text).success, false, text);
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
test('partial scope invalidation reaches all pages/filters without invalidating another exam', async () => {
  const cache = new QueryClient();
  const scope = {
    schoolId: 'school',
    sessionId: 'session',
    examSlug: 'midterm',
    classId: 'class-a',
    studentId: 'enrollment',
  };
  const prefix = [
    ['school', 'listExamStudents'],
    { input: toExamScope(scope) },
  ];
  const first = [
    ['school', 'listExamStudents'],
    { input: { ...toExamScope(scope), page: 1 } },
  ];
  const second = [
    ['school', 'listExamStudents'],
    { input: { ...toExamScope(scope), page: 2 } },
  ];
  const other = [
    ['school', 'listExamStudents'],
    { input: { ...toExamScope(scope), examSlug: 'other-exam', page: 1 } },
  ];
  [first, second, other].forEach((key) => cache.setQueryData(key, []));
  await cache.invalidateQueries({ queryKey: prefix });
  assert.equal(cache.getQueryState(first)?.isInvalidated, true);
  assert.equal(cache.getQueryState(second)?.isInvalidated, true);
  assert.equal(cache.getQueryState(other)?.isInvalidated, false);
  cache.clear();
});
test('programmatic scope changes await the mounted editor’s app dialog decision', async () => {
  let decide!: (discard: boolean) => void;
  const unregister = registerNavigationGuard(
    () =>
      new Promise<boolean>((resolve) => {
        decide = resolve;
      }),
  );
  let settled = false;
  const navigation = confirmNavigation().then((allowed) => {
    settled = true;
    return allowed;
  });
  await Promise.resolve();
  assert.equal(
    settled,
    false,
    'scope changes wait while the app dialog is open',
  );
  decide(false);
  assert.equal(await navigation, false);
  unregister();
  assert.equal(await confirmNavigation(), true);
});

test('a timetable validation failure can be corrected and submitted without stale nested errors', async () => {
  let calls = 0;
  const values: z.infer<ReturnType<typeof timetableFormSchema>> = {
    config: { columns: ['class-a'], rows: [slot('a', '10:00', '09:00')] },
    classId: 'class-a',
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

test('copying slot timing preserves dates, stable identities and hidden class assessments', () => {
  const rows = [
    slot('first', '09:00', '10:00'),
    { ...slot('second', '11:00', '12:00', 'class-b'), date: '2026-12-31' },
  ];
  const before = structuredClone(rows);
  const copied = copyTimetableTiming(rows, 'first', 'second');
  assert.deepEqual(rows, before);
  assert.deepEqual(copied[1], {
    ...before[1],
    startTime: '09:00',
    endTime: '10:00',
  });
  assert.equal(copied[0], rows[0]);
  assert.equal(copied[1]?.cells, rows[1]?.cells);
});

test('removing a timetable column deletes only that class and preserves other assignments', () => {
  const row = {
    ...slot('first', '09:00', '10:00'),
    cells: { 'class-a': cell, 'class-b': [cell] },
  };
  const config = { columns: ['class-b', 'class-a'], rows: [row] };
  const removed = removeTimetableColumn(config, 'class-a');
  assert.deepEqual(removed.columns, ['class-b']);
  assert.deepEqual(removed.rows[0], { ...row, cells: { 'class-b': [cell] } });
  assert.deepEqual(config.columns, ['class-b', 'class-a']);
  assert.deepEqual(config.rows[0]?.cells['class-a'], cell);
});

test('timetable date defaults follow the local calendar across leap/month/year boundaries', () => {
  const dated = (date: string) => [
    { ...slot('first', '09:00', '10:00'), date },
  ];
  assert.equal(nextTimetableDate(dated('2028-02-28')), '2028-02-29');
  assert.equal(nextTimetableDate(dated('2028-02-29')), '2028-03-01');
  assert.equal(nextTimetableDate(dated('2026-12-31')), '2027-01-01');
  assert.equal(
    nextTimetableDate(dated('2026-02-30'), new Date(2026, 9, 15, 23, 59)),
    '2026-10-15',
  );
  assert.equal(parseTimetableDate('2026-02-30'), null);
  assert.equal(parseTimetableDate('2028-02-29')?.getDate(), 29);
});

test('combined assessment selection round-trips slugs containing separator characters', () => {
  const pair = { subjectSlug: 'math::science', modeSlug: 'oral:practical' };
  assert.deepEqual(decodeTimetablePair(encodeTimetablePair(pair)), pair);
  assert.equal(decodeTimetablePair(''), null);
});

test('an incomplete additional timetable assessment points to that selector, not the valid first one', () => {
  const parsed = timetableSchema(context).safeParse({
    columns: ['class-a'],
    rows: [
      {
        ...slot('a', '09:00', '10:00'),
        cells: { 'class-a': [cell, { subjectSlug: '', modeSlug: '' }] },
      },
    ],
  });
  assert.equal(parsed.success, false);
  const issue = parsed.error?.issues.find(
    (issue) =>
      issue.code === 'custom' && issue.message.includes('configured subject'),
  );
  assert.deepEqual(issue?.path, ['rows', 0, 'cells', 'class-a', 1]);
});

test('examination actions do not submit a form unless explicitly declared as save actions', () => {
  assert.match(
    renderToStaticMarkup(createElement(ExamButton, {}, 'Preview')),
    /type="button"/,
  );
  assert.match(
    renderToStaticMarkup(createElement(ExamButton, { type: 'submit' }, 'Save')),
    /type="submit"/,
  );
});

test('only an explicit start transition unlocks result navigation', () => {
  assert.equal(hasExamStarted(null), false);
  assert.equal(hasExamStarted('ready'), false);
  assert.equal(hasExamStarted('active'), true);
  assert.equal(hasExamStarted('completed'), true);
});

test('only a completed examination unlocks report cards', () => {
  assert.equal(canCreateExamReportCards(null), false);
  assert.equal(canCreateExamReportCards('ready'), false);
  assert.equal(canCreateExamReportCards('active'), false);
  assert.equal(canCreateExamReportCards('completed'), true);
});

test('ambiguous exam saves require reloading while definitive rejections can be corrected', () => {
  for (const error of [
    new TypeError('Failed to fetch'),
    { code: 'INTERNAL_SERVER_ERROR' },
    null,
  ])
    assert.equal(isExamSaveUncertain(error), true);
  for (const code of [
    'BAD_REQUEST',
    'UNAUTHORIZED',
    'FORBIDDEN',
    'NOT_FOUND',
    'CONFLICT',
  ])
    assert.equal(isExamSaveUncertain({ code }), false);
});
