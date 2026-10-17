import { FormApi, FieldApi } from '@tanstack/react-form';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StudentExamPreview } from '@campuspilot/components/exam/student-exam-preview';
import { isExamResultEntryOpen, examClassStatusLabel } from './exam-model';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { StudentExamWorkspaceDto } from '@campuspilot/api/routers/school/exam/exam.dto';
import {
  studentExamDefaults,
  studentExamPayload,
  studentExamSchema,
} from './exam-student-workspace-model';

function workspace(): StudentExamWorkspaceDto {
  return {
    student: {
      studentId: 'student',
      name: 'Student',
      admissionNo: 'A1',
      rollNo: 1,
      sectionId: null,
      sectionLabel: null,
      savedSubjects: 0,
      approvedSubjects: 0,
      subjectCount: 2,
      assessmentApproved: false,
    },
    className: 'Nursery',
    totalWorkingDays: 100,
    assessment: null,
    context: {
      exam: { slug: 'term', name: 'Term', order: 1 },
      classes: [
        {
          id: 'class',
          label: 'Nursery',
          subjects: {
            maths: {
              name: 'Maths',
              examModes: {
                written: { name: 'Written', percentage: 80 },
                oral: { name: 'Oral', percentage: 20 },
              },
            },
            english: {
              name: 'English',
              examModes: { written: { name: 'Written', percentage: 100 } },
            },
          },
        },
      ],
      coScholasticAreas: { art: { name: 'Art' } },
      attendanceTracking: { enabled: true },
    },
    subjects: [
      {
        plan: {
          id: 'maths',
          schoolId: 'school',
          sessionId: 'session',
          examSlug: 'term',
          classId: 'class',
          subjectSlug: 'maths',
          totalMarks: 100,
          modeConfig: {
            written: { percentage: 80, maxMarks: 80 },
            oral: { percentage: 20, maxMarks: 20 },
          },
          status: 'active',
          totalWorkingDays: null,
          createdAt: null,
          updatedAt: null,
        },
        result: null,
      },
      {
        plan: {
          id: 'english',
          schoolId: 'school',
          sessionId: 'session',
          examSlug: 'term',
          classId: 'class',
          subjectSlug: 'english',
          totalMarks: 100,
          modeConfig: { written: { percentage: 100, maxMarks: 100 } },
          status: 'active',
          totalWorkingDays: null,
          createdAt: null,
          updatedAt: null,
        },
        result: null,
      },
    ],
  };
}
const complete = (data: StudentExamWorkspaceDto) => {
  const value = studentExamDefaults(data);
  value.subjects.forEach((subject) =>
    subject.marks.forEach((mark) => {
      mark.value = '0';
    }),
  );
  return value;
};
test('blank marks are not fabricated zeroes; entered zeroes are valid across all subjects', () => {
  const data = workspace();
  assert.equal(
    studentExamSchema(data).safeParse(studentExamDefaults(data)).success,
    false,
  );
  const value = complete(data);
  assert.equal(studentExamSchema(data).safeParse(value).success, true);
  assert.deepEqual(studentExamPayload(value), {
    subjects: [
      { examPlanId: 'maths', marks: { written: 0, oral: 0 } },
      { examPlanId: 'english', marks: { written: 0 } },
    ],
    coScholastics: null,
    daysAttended: null,
    approved: false,
  });
});
test('subject-specific limits and decimal marks produce adjacent error paths', () => {
  const data = workspace();
  const value = complete(data);
  value.subjects[0]!.marks[1]!.value = '20.5';
  const result = studentExamSchema(data).safeParse(value);
  assert.equal(result.success, false);
  assert.deepEqual(result.error!.issues[0]!.path, [
    'subjects',
    0,
    'marks',
    1,
    'value',
  ]);
  value.subjects[0]!.marks[1]!.value = '19.5';
  assert.equal(studentExamSchema(data).safeParse(value).success, true);
});
test('attendance uses explicit shared working days and enabled session tracking', () => {
  const data = workspace();
  const value = complete(data);
  value.daysAttended = '100';
  assert.equal(studentExamSchema(data).safeParse(value).success, true);
  value.daysAttended = '101';
  assert.equal(studentExamSchema(data).safeParse(value).success, false);
  value.daysAttended = '1.5';
  assert.equal(studentExamSchema(data).safeParse(value).success, false);
  value.daysAttended = '80';
  data.totalWorkingDays = null;
  assert.equal(studentExamSchema(data).safeParse(value).success, false);
  data.totalWorkingDays = 100;
  data.context.attendanceTracking.enabled = false;
  assert.equal(studentExamSchema(data).safeParse(value).success, false);
  value.daysAttended = '';
  assert.equal(studentExamSchema(data).safeParse(value).success, true);
});
test('shared grades preserve explicit historical data and require clearing removed areas', () => {
  const data = workspace();
  data.assessment = {
    daysAttended: null,
    coScholastics: { music: 'A' },
    approved: false,
    updatedAt: new Date(),
  };
  const value = complete(data);
  assert.equal(studentExamSchema(data).safeParse(value).success, false);
  value.grades.find((grade) => grade.slug === 'music')!.value = '';
  value.grades.find((grade) => grade.slug === 'art')!.value = ' B+ ';
  value.approved = true;
  assert.equal(studentExamSchema(data).safeParse(value).success, true);
  assert.deepEqual(studentExamPayload(value).coScholastics, { art: 'B+' });
  assert.equal(studentExamPayload(value).approved, true);
});

test('all subjects and modes must appear exactly once before preview/save', () => {
  const data = workspace();
  const missingSubject = complete(data);
  missingSubject.subjects.pop();
  assert.equal(
    studentExamSchema(data).safeParse(missingSubject).success,
    false,
  );
  const duplicateMode = complete(data);
  duplicateMode.subjects[0]!.marks[1]!.slug = 'written';
  assert.equal(studentExamSchema(data).safeParse(duplicateMode).success, false);
  const missingMode = complete(data);
  missingMode.subjects[0]!.marks.pop();
  assert.equal(studentExamSchema(data).safeParse(missingMode).success, false);
});

test('plan readiness never substitutes for the explicit examination start', () => {
  const active = [{ status: 'active' as const }];
  assert.equal(isExamResultEntryOpen(true, 'ready', active), false);
  assert.equal(isExamResultEntryOpen(true, null, active), false);
  assert.equal(isExamResultEntryOpen(true, 'completed', active), false);
  assert.equal(isExamResultEntryOpen(false, 'active', active), false);
  assert.equal(
    isExamResultEntryOpen(true, 'active', [{ status: 'draft' }]),
    false,
  );
  assert.equal(isExamResultEntryOpen(true, 'active', []), false);
  assert.equal(isExamResultEntryOpen(true, 'active', active), true);
  assert.equal(examClassStatusLabel('ready', ['active']), 'Not started');
  assert.equal(examClassStatusLabel('completed', ['active']), 'Completed');
});

test('the active student form cannot submit blank marks and accepts explicit zeroes', async () => {
  const data = workspace();
  let calls = 0;
  const form = new FormApi({
    defaultValues: studentExamDefaults(data),
    validators: { onSubmit: studentExamSchema(data) },
    onSubmit: () => {
      calls++;
    },
  });
  const unmount = form.mount();
  const fields = [
    new FieldApi({ form, name: 'subjects[0].marks[0].value' }),
    new FieldApi({ form, name: 'subjects[0].marks[1].value' }),
    new FieldApi({ form, name: 'subjects[1].marks[0].value' }),
  ];
  const unmountFields = fields.map((field) => field.mount());
  await form.handleSubmit();
  assert.equal(calls, 0);
  fields.forEach((field) => field.handleChange('0'));
  await form.handleSubmit();
  assert.equal(calls, 1);
  unmountFields.forEach((cleanup) => cleanup());
  unmount();
});

test('zero-maximum modes still require an explicit zero in the student-wide form', () => {
  const data = workspace();
  data.subjects[0]!.plan.modeConfig.extra = { percentage: 0, maxMarks: 0 };
  const value = complete(data);
  value.subjects[0]!.marks[2]!.value = '';
  assert.equal(studentExamSchema(data).safeParse(value).success, false);
  value.subjects[0]!.marks[2]!.value = '0';
  assert.equal(studentExamSchema(data).safeParse(value).success, true);
});

test('refetched defaults preserve a dirty student-wide draft and its shared metadata', () => {
  const data = workspace();
  data.assessment = {
    daysAttended: 80,
    coScholastics: { art: 'A' },
    approved: false,
    updatedAt: new Date(),
  };
  const initial = complete(data);
  const form = new FormApi({
    defaultValues: initial,
    validators: { onSubmit: studentExamSchema(data) },
  });
  const unmount = form.mount();
  const field = new FieldApi({ form, name: 'subjects[0].marks[0].value' });
  const unmountField = field.mount();
  field.handleChange('66');
  form.update({
    defaultValues: {
      ...initial,
      subjects: complete(data).subjects,
      daysAttended: '50',
      grades: [{ slug: 'art', value: 'B' }],
    },
  });
  assert.equal(form.state.values.subjects[0]!.marks[0]!.value, '66');
  assert.equal(form.state.values.daysAttended, '80');
  assert.equal(form.state.values.grades[0]!.value, 'A');
  unmountField();
  unmount();
});

test('student preview sums weighted maxima directly and separates shared and historical assessments', () => {
  const data = workspace();
  const plan = data.subjects[0]!.plan;
  data.subjects[0]!.result = {
    id: 'result',
    schoolId: plan.schoolId,
    sessionId: plan.sessionId,
    examPlanId: plan.id,
    studentId: data.student.studentId,
    marks: { written: 65, oral: 18 },
    coScholastics: { art: 'Legacy' },
    daysAttended: 10,
    approved: false,
    createdAt: null,
    updatedAt: null,
  };
  data.assessment = {
    daysAttended: 80,
    coScholastics: { art: 'A' },
    approved: true,
    updatedAt: new Date(),
  };
  const html = renderToStaticMarkup(
    createElement(StudentExamPreview, { data }),
  );
  assert.match(html, /83 \/ 100/);
  assert.match(html, /Awaiting review/);
  assert.match(html, /Historical subject assessments/);
  assert.match(html, /Legacy/);
  assert.match(html, /80/);
  assert.match(html, /Not entered/);
});
