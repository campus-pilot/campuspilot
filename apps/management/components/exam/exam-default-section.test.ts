import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { defaultExamSection, examSectionOf, questionPaperWorkspaceHref } from './exam-model';

test('Question paper is the default only for a ready exam with a plan and an allowed assistant', () => {
  assert.equal(defaultExamSection({ planCount: 3, status: 'ready', assistant: 'allowed' }), 'question-paper');
  assert.equal(defaultExamSection({ planCount: 3, status: 'ready', assistant: 'denied' }), 'results');
  assert.equal(defaultExamSection({ planCount: 3, status: 'active', assistant: 'allowed' }), 'results');
  assert.equal(defaultExamSection({ planCount: 3, status: 'completed', assistant: 'allowed' }), 'results');
  // No plan: Results holds plan creation.
  assert.equal(defaultExamSection({ planCount: 0, status: 'ready', assistant: 'allowed' }), 'results');
  assert.equal(defaultExamSection({ planCount: 0, status: null, assistant: 'allowed' }), 'results');
  // A plan alone is not a lifecycle state.
  assert.equal(defaultExamSection({ planCount: 3, status: null, assistant: 'allowed' }), 'results');
});

test('the landing waits for the assistant answer only when it matters', () => {
  assert.equal(defaultExamSection({ planCount: 3, status: 'ready', assistant: 'pending' }), 'pending');
  // Whatever the assistant says, these never become Question paper, so no waiting.
  assert.equal(defaultExamSection({ planCount: 3, status: 'active', assistant: 'pending' }), 'results');
  assert.equal(defaultExamSection({ planCount: 0, status: 'ready', assistant: 'pending' }), 'results');
});

test('pathnames map to workspace tabs', () => {
  const base = '/school/s/sessions/x/exam/half-yearly';
  assert.equal(examSectionOf(base, base), 'results');
  assert.equal(examSectionOf(`${base}/`, base), 'results');
  assert.equal(examSectionOf(`${base}/results`, base), 'results');
  assert.equal(examSectionOf(`${base}/classes/c1`, base), 'results');
  assert.equal(examSectionOf(`${base}/question-paper`, base), 'question-paper');
  assert.equal(examSectionOf(`${base}/question-paper/c1/sci/theory`, base), 'question-paper');
  assert.equal(examSectionOf(`${base}/timetable`, base), 'timetable');
  assert.equal(examSectionOf(`${base}/settings`, base), 'settings');
  // A class whose id starts like the section is still Results.
  assert.equal(examSectionOf(`${base}/classes/question-paper`, base), 'results');
});

test('paper links encode every segment and keep the section in the query', () => {
  const scope = { schoolId: 's', sessionId: 'x', examSlug: 'half yearly', classId: 'c/1', subjectSlug: 'sci', modeSlug: 'theory' };
  assert.equal(
    questionPaperWorkspaceHref(scope),
    '/school/s/sessions/x/exam/half%20yearly/question-paper/c%2F1/sci/theory',
  );
  assert.equal(
    questionPaperWorkspaceHref(scope, { section: 'result', version: 2 }),
    '/school/s/sessions/x/exam/half%20yearly/question-paper/c%2F1/sci/theory?section=result&version=2',
  );
});
