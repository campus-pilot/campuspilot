import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ExamPlanPreviewDto } from '@campuspilot/api/routers/school/exam/exam.dto';

import { participatingClassIds, selectedPlanCount, selectionIssue } from './exam-class-model';

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
