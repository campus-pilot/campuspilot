import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { AssistantTimelineRow } from '@campuspilot/components/assistant/timeline-model';

import { approvalFactsOf, draftCheckOf, paperLabelFromKey, paperLabelOf } from './assistant-question-paper-model';

const input = {
  schoolId: 's',
  sessionId: 'ss',
  examSlug: 'annual',
  classId: 'c',
  subjectSlug: 'maths',
  modeSlug: 'oral',
  html: '<p>Q</p>',
};
const result = { valid: true, problems: [], stripped: [], draftId: 'aaaaaaaaaaaa', placeholderFigures: 0 };
const names = { subjectName: 'Mathematics', modeName: 'Oral', className: 'Class 5', examName: 'Annual Examination' };

test('names a paper for a sentence, and by its key before the names are known', () => {
  assert.equal(paperLabelOf(names), 'Mathematics (Oral), Class 5, Annual Examination');
  assert.equal(paperLabelFromKey(input), 'maths (oral), annual');
});

test('a trusted stored result is shown and the re-check is not needed', () => {
  assert.deepEqual(draftCheckOf({ input, stored: result, recheck: { data: undefined, isError: false } }), { state: 'ready', result });
});

test('a cut result waits for the re-check, uses it, and says so when the re-check failed instead of waiting for ever', () => {
  assert.deepEqual(draftCheckOf({ input, stored: null, recheck: { data: undefined, isError: false } }), { state: 'checking' });
  assert.deepEqual(draftCheckOf({ input, stored: null, recheck: { data: result, isError: false } }), { state: 'ready', result });
  assert.deepEqual(draftCheckOf({ input, stored: null, recheck: { data: undefined, isError: true } }), { state: 'failed' });
  // A held result wins over a later failed refetch.
  assert.deepEqual(draftCheckOf({ input, stored: null, recheck: { data: result, isError: true } }), { state: 'ready', result });
});

test('an input that is not a draft call has nothing to show', () => {
  assert.deepEqual(draftCheckOf({ input: null, stored: result, recheck: { data: undefined, isError: false } }), { state: 'unreadable' });
});

test('approval facts: the paper label once the names arrived and the ordinal of the draft the input names', () => {
  const rows = [
    {
      kind: 'card',
      id: 'x',
      card: 'question_paper_draft',
      call: {
        id: 'x',
        body: { toolName: 'school.validateQuestionPaperDraft', input, output: JSON.stringify(result), outputTruncated: false },
      },
    },
  ] as unknown as AssistantTimelineRow[];
  const save = { ...input, draftId: 'aaaaaaaaaaaa', expectedVersionNo: 1 };
  const tool = 'school.saveQuestionPaperVersion';
  assert.deepEqual(approvalFactsOf({ toolName: tool, input: save, rows, paper: names }), {
    paperLabel: 'Mathematics (Oral), Class 5, Annual Examination',
    draftOrdinal: 1,
  });
  assert.deepEqual(approvalFactsOf({ toolName: tool, input: save, rows, paper: null }), { paperLabel: null, draftOrdinal: 1 });
  assert.deepEqual(approvalFactsOf({ toolName: tool, input: { ...save, draftId: 'zzzzzzzzzzzz' }, rows, paper: names }).draftOrdinal, null);
  assert.deepEqual(approvalFactsOf({ toolName: 'school.updateAdmission', input: save, rows, paper: names }).draftOrdinal, null);
});
