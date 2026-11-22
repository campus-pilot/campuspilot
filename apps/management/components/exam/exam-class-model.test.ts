import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FieldApi, FormApi } from '@tanstack/react-form';
import type { ExamPlanPreviewDto } from '@campuspilot/api/routers/school/exam/exam.dto';

import {
  changedKeptClasses,
  classSelectionFormOptions,
  editClassesBase,
  editClassesSubjects,
  editSelectionIssue,
  participatingClassIds,
  selectedPlanCount,
  selectionIssue,
  subjectsForClasses,
} from './exam-class-model';

const mode = { slug: 'written', name: 'Written', percentage: 100, maxMarks: 100 };
const preview: ExamPlanPreviewDto = {
  totalMarks: 100,
  configurationVersion: 'a'.repeat(64),
  planCount: 3,
  existingPlanCount: 0,
  classes: [
    {
      classId: 'six',
      label: 'Class 6',
      studentCount: 10,
      participating: true,
      subjects: [
        { subjectSlug: 'maths', name: 'Maths', planned: true, issue: null, modes: [mode] },
        { subjectSlug: 'art', name: 'Art', planned: false, issue: null, modes: [mode] },
      ],
    },
    {
      classId: 'seven',
      label: 'Class 7',
      studentCount: 12,
      participating: false,
      subjects: [
        { subjectSlug: 'maths', name: 'Maths', planned: false, issue: null, modes: [mode] },
        { subjectSlug: 'science', name: 'Science', planned: false, issue: 'Percentages must total 100%.', modes: [] },
      ],
    },
  ],
};

describe('exam class selection', () => {
  it('reports an invalid subject only for a chosen class', () => {
    assert.equal(selectionIssue(preview, ['six']), null);
    assert.equal(selectionIssue(preview, ['six', 'seven']), 'Class 7 · Science: Percentages must total 100%.');
  });

  it('counts the plans of the chosen classes', () => {
    assert.equal(selectedPlanCount(preview, ['six']), 2);
    assert.equal(selectedPlanCount(preview, ['six', 'seven']), 4);
    assert.equal(selectedPlanCount(preview, []), 0);
  });

  it('follows the chosen subjects: counts, an empty choice and an invalid subject left out', () => {
    assert.equal(selectedPlanCount(preview, ['six', 'seven'], { seven: ['maths'] }), 3);
    assert.equal(selectionIssue(preview, ['six', 'seven'], { seven: ['maths'] }), null);
    assert.equal(selectionIssue(preview, ['six', 'seven'], { seven: [] }), 'Class 7: select at least one subject.');
    assert.deepEqual(subjectsForClasses(['seven'], { six: ['maths'], seven: ['maths'] }), { seven: ['maths'] });
  });

  it('starts Edit classes from the planned subjects and sends only kept classes whose subjects change', () => {
    const base = editClassesBase(preview);
    assert.deepEqual(base, { classIds: ['six'], subjects: { six: ['maths'], seven: ['maths', 'science'] } });
    assert.deepEqual(editClassesSubjects(preview, base), {});
    const ticked = { classIds: ['six'], subjects: { ...base.subjects, six: ['maths', 'art'] } };
    assert.deepEqual(changedKeptClasses(preview, ticked), ['six']);
    assert.deepEqual(editClassesSubjects(preview, ticked), { six: ['maths', 'art'] });
    assert.equal(editSelectionIssue(preview, { classIds: ['six'], subjects: { ...base.subjects, six: [] } }), 'Class 6: select at least one subject.');
    assert.equal(editSelectionIssue(preview, { classIds: ['six', 'seven'], subjects: base.subjects }), 'Class 7 · Science: Percentages must total 100%.');
    assert.deepEqual(editClassesSubjects(preview, { classIds: ['six', 'seven'], subjects: { ...base.subjects, seven: ['maths'] } }), { seven: ['maths'] });
  });

  it('lists the classes taking part now', () => {
    assert.deepEqual(participatingClassIds(preview), ['six']);
  });
});

describe('saving a class selection', () => {
  it('keeps the save available after a refusal, so the same selection can be retried', async () => {
    const saved: string[][] = [];
    const events: string[] = [];
    let refuse = true;
    const form = new FormApi(
      classSelectionFormOptions({
        classIds: ['six'],
        save: async ({ classIds }) => {
          saved.push(classIds);
          if (refuse) throw new Error('Class 7 has saved results.');
        },
        onAttempt: () => events.push('attempt'),
        onRefused: (error) => {
          events.push(`refused: ${error instanceof Error ? error.message : String(error)}`);
        },
      }),
    );
    const unmount = form.mount();
    const field = new FieldApi({ form, name: 'classIds' });
    const unmountField = field.mount();
    field.handleChange(['six', 'seven']);

    await form.handleSubmit();
    assert.deepEqual(events, ['attempt', 'refused: Class 7 has saved results.']);
    // The button is gated on canSubmit: a refusal must not close it.
    assert.equal(form.state.canSubmit, true);
    assert.equal(form.state.errors.length, 0);

    refuse = false;
    await form.handleSubmit();
    assert.deepEqual(saved, [
      ['six', 'seven'],
      ['six', 'seven'],
    ]);
    assert.deepEqual(events, ['attempt', 'refused: Class 7 has saved results.', 'attempt']);
    assert.equal(form.state.canSubmit, true);
    unmountField();
    unmount();
  });

  it('does not save an empty selection', async () => {
    let calls = 0;
    const form = new FormApi(
      classSelectionFormOptions({
        classIds: ['six'],
        save: async () => {
          calls++;
        },
        onAttempt: () => {},
        onRefused: () => {},
      }),
    );
    const unmount = form.mount();
    const field = new FieldApi({ form, name: 'classIds' });
    const unmountField = field.mount();
    field.handleChange([]);
    await form.handleSubmit();
    assert.equal(calls, 0);
    unmountField();
    unmount();
  });
});
