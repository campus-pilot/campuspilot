import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FieldApi, FormApi } from '@tanstack/react-form';
import type { ExamPlanPreviewDto } from '@campuspilot/api/routers/school/exam/exam.dto';

import {
  classSelectionFormOptions,
  participatingClassIds,
  selectedPlanCount,
  selectionIssue,
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
      subjects: [{ subjectSlug: 'maths', name: 'Maths', issue: null, modes: [mode] }],
    },
    {
      classId: 'seven',
      label: 'Class 7',
      studentCount: 12,
      participating: false,
      subjects: [
        { subjectSlug: 'maths', name: 'Maths', issue: null, modes: [mode] },
        { subjectSlug: 'science', name: 'Science', issue: 'Percentages must total 100%.', modes: [] },
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
    assert.equal(selectedPlanCount(preview, ['six']), 1);
    assert.equal(selectedPlanCount(preview, ['six', 'seven']), 3);
    assert.equal(selectedPlanCount(preview, []), 0);
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
        save: async (classIds) => {
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
